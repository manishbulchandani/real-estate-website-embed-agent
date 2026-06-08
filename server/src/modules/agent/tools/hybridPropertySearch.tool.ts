import mongoose from "mongoose";
import { generateEmbedding } from "../../../utils/vector.util";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getCityCacheEntry, setCityCacheEntry } from "../../../services/cityCache.service";


/**
 * Tool: Hybrid property search using MongoDB vector search + structured filters
 */
export async function hybridPropertySearch(params: {
  query?: string;
  filters?: Record<string, any>;
  maxResults?: number;
  excludeIds?: string[];
}): Promise<
  {
    id: string;
    title: string;
    description: string;
    price: number;
    bhk: number;
    propertyType: string;
    furnished: string;
    builtUpArea: number | null;
    age: number | null;
    listingType: string;
    listingScope: string;
    variantLabel: string | null;
    project: {
      id: string;
      title: string;
      developer: string;
      webpageUrl: string | null;
      locality: string;
      city: string;
      images: string[];
      priceRange: {
        min: number | null;
        max: number | null;
      } | null;
    } | null;
    locality: string;
    city: string;
    address: string;
    images: string[];
    bestFor: string;
    amenities: string;
    nearbyAmenities: string;
    availableFrom: string | null;
  }[]
> {
  // Dynamic import to avoid circular dependencies
  const mongooseConnection = mongoose.connection;

  if (!mongooseConnection.db) {
    throw new Error("MongoDB connection not established");
  }

  const db = mongooseConnection.db;
  const listingsCollection = db.collection("listings");

  const resultLimit = params.maxResults || 10;
  const oversampleLimit = Math.max(resultLimit * 2, 20);
  const hasQuery = Boolean(params.query?.trim());
  const hasFilters = Boolean(
    params.filters && Object.keys(params.filters).length > 0
  );

  const lookupProjectStage = {
    $lookup: {
      from: "projects",
      localField: "projectId",
      foreignField: "_id",
      as: "project",
    },
  };

  const unwindProjectStage = {
    $unwind: {
      path: "$project",
      preserveNullAndEmptyArrays: true,
    },
  };

  const projectionStage = {
    $project: {
      _id: 1,
      projectId: 1,
      listingScope: 1,
      variantLabel: 1,
      "metadata.bhk": 1,
      "metadata.price": 1,
      "metadata.propertyType": 1,
      "metadata.furnished": 1,
      "metadata.builtUpArea": 1,
      "metadata.age": 1,
      "metadata.listing_type": 1,
      "metadata.amenities": 1,
      "metadata.nearby_amenities": 1,
      "metadata.suitability": 1,
      "metadata.images": 1,
      "location.locality": 1,
      "location.city": 1,
      "location.address": 1,
      title: 1,
      description: 1,
      availableFrom: 1,
      "project._id": 1,
      "project.title": 1,
      "project.developer": 1,
      "project.webpageUrl": 1,
      "project.location.locality": 1,
      "project.location.city": 1,
      "project.images": 1,
      "project.priceRange.min": 1,
      "project.priceRange.max": 1,
    },
  };

  const buildTextQueryMatch = (query: string) => {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {
      $match: {
        $or: [
          { title: { $regex: escapedQuery, $options: "i" } },
          { description: { $regex: escapedQuery, $options: "i" } },
          { "project.title": { $regex: escapedQuery, $options: "i" } },
          { "location.locality": { $regex: escapedQuery, $options: "i" } },
          { "location.city": { $regex: escapedQuery, $options: "i" } },
          { "location.address": { $regex: escapedQuery, $options: "i" } },
          { "metadata.propertyType": { $regex: escapedQuery, $options: "i" } },
          { "metadata.listing_type": { $regex: escapedQuery, $options: "i" } },
          { variantLabel: { $regex: escapedQuery, $options: "i" } },
        ],
      },
    };
  };

  const buildBroadenedTextQueryMatch = (query: string) => {
    const tokens = query
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .slice(0, 6);

    if (tokens.length === 0) {
      return buildTextQueryMatch(query);
    }

    const tokenClauses = tokens.map((token) => {
      const safeToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return {
        $or: [
          { title: { $regex: safeToken, $options: "i" } },
          { description: { $regex: safeToken, $options: "i" } },
          { "project.title": { $regex: safeToken, $options: "i" } },
          { "location.locality": { $regex: safeToken, $options: "i" } },
          { "location.city": { $regex: safeToken, $options: "i" } },
          { "location.address": { $regex: safeToken, $options: "i" } },
          { "metadata.propertyType": { $regex: safeToken, $options: "i" } },
          { "metadata.listing_type": { $regex: safeToken, $options: "i" } },
          { variantLabel: { $regex: safeToken, $options: "i" } },
        ],
      };
    });

    return {
      $match: {
        $or: tokenClauses,
      },
    };
  };

  const buildRelaxedFilters = (filters: Record<string, any>) => {
    const relaxed = normalizeSearchFilters(filters);

    if (typeof relaxed.budgetMin === "number") {
      relaxed.budgetMin = Math.max(0, Math.floor(relaxed.budgetMin * 0.85));
    }
    if (typeof relaxed.budgetMax === "number") {
      relaxed.budgetMax = Math.ceil(relaxed.budgetMax * 1.15);
    }

    if (relaxed.locality) {
      delete relaxed.locality;
    }

    if (relaxed.budgetMin !== undefined || relaxed.budgetMax !== undefined) {
      delete relaxed.budgetMin;
      delete relaxed.budgetMax;
    }

    return relaxed;
  };

  const runQueryBranch = async (options: {
    useVector: boolean;
    broadenText: boolean;
    vectorStage?: any | null;
  }) => {
    if (!hasQuery) {
      return [];
    }

    const pipeline: any[] = [];

    if (options.useVector && options.vectorStage) {
      pipeline.push(options.vectorStage);
    } else {
      const textMatch = options.broadenText
        ? buildBroadenedTextQueryMatch(params.query!.trim())
        : buildTextQueryMatch(params.query!.trim());
      pipeline.push(textMatch);
    }

    if (params.excludeIds && params.excludeIds.length > 0) {
      const objectIds = params.excludeIds
        .map((id) => {
          try {
            return new mongoose.Types.ObjectId(id);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      if (objectIds.length > 0) {
        pipeline.push({ $match: { _id: { $nin: objectIds } } });
      }
    }

    pipeline.push(lookupProjectStage);
    pipeline.push(unwindProjectStage);
    pipeline.push({ $limit: oversampleLimit });
    pipeline.push(projectionStage);

    return listingsCollection.aggregate(pipeline).toArray();
  };

  const runFilterBranch = async (options: { relaxed: boolean }) => {
    if (!hasFilters) {
      return [];
    }

    const baseFilters = normalizeSearchFilters(
      options.relaxed ? buildRelaxedFilters(params.filters!) : params.filters!,
    );
    console.log("[Tools] Normalized search filters", {
      relaxed: options.relaxed,
      filters: baseFilters,
    });
    const mongoFilters = buildMongoDbFilters(baseFilters);

    if (params.excludeIds && params.excludeIds.length > 0) {
      const objectIds = params.excludeIds
        .map((id) => {
          try {
            return new mongoose.Types.ObjectId(id);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      if (objectIds.length > 0) {
        mongoFilters["_id"] = { $nin: objectIds };
      }
    }

    if (Object.keys(mongoFilters).length === 0) {
      return [];
    }

    const pipeline: any[] = [
      { $match: mongoFilters },
      lookupProjectStage,
      unwindProjectStage,
      { $limit: oversampleLimit },
      projectionStage,
    ];

    return listingsCollection.aggregate(pipeline).toArray();
  };

  const dedupeAndTrim = (results: any[]) => {
    const unique = new Map<string, any>();
    for (const doc of results) {
      unique.set(String(doc._id), doc);
      if (unique.size >= resultLimit) {
        break;
      }
    }
    return Array.from(unique.values());
  };

  const toStringList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (value === null || value === undefined) {
      return [];
    }
    return [String(value)];
  };

  const transformResults = (results: any[]) =>
    results.map((doc: any) => {
      const suitability = toStringList(doc.metadata?.suitability);
      const amenities = toStringList(doc.metadata?.amenities);
      const nearbyAmenities = toStringList(doc.metadata?.nearby_amenities);
      const listingImages = toStringList(doc.metadata?.images);
      const projectImages = toStringList(doc.project?.images);
      const images = listingImages.length > 0 ? listingImages : projectImages;

      return {
        id: doc._id.toString(),
        title: doc.title || "Property Listing",
        description: String(doc.description || "").trim(),
        price: Number(doc.metadata?.price || 0),
        bhk: Number(doc.metadata?.bhk || 0),
        propertyType: String(doc.metadata?.propertyType || "Property"),
        furnished: String(doc.metadata?.furnished || "Not specified"),
        listingScope: String(doc.listingScope || "standalone"),
        variantLabel: doc.variantLabel ? String(doc.variantLabel) : null,
        project: doc.project?._id
          ? {
            id: String(doc.project._id),
            title: String(doc.project.title || ""),
            developer: String(doc.project.developer || ""),
            webpageUrl: doc.project.webpageUrl ? String(doc.project.webpageUrl) : null,
            locality: String(doc.project.location?.locality || ""),
            city: String(doc.project.location?.city || ""),
            images: projectImages,
            priceRange:
              doc.project.priceRange?.min !== undefined ||
                doc.project.priceRange?.max !== undefined
                ? {
                  min:
                    doc.project.priceRange?.min !== undefined
                      ? Number(doc.project.priceRange.min)
                      : null,
                  max:
                    doc.project.priceRange?.max !== undefined
                      ? Number(doc.project.priceRange.max)
                      : null,
                }
                : null,
          }
          : null,
        builtUpArea:
          doc.metadata?.builtUpArea !== undefined &&
          doc.metadata?.builtUpArea !== null
            ? Number(doc.metadata?.builtUpArea)
            : null,
        age:
          doc.metadata?.age !== undefined && doc.metadata?.age !== null
            ? Number(doc.metadata?.age)
            : null,
        listingType: String(doc.metadata?.listing_type || "Unknown"),
        locality: doc.location?.locality || "Unknown",
        city: doc.location?.city || "Unknown",
        address: doc.location?.address || "",
        images,
        bestFor: suitability.join(", ") || "All",
        amenities: amenities.join(", ") || "N/A",
        nearbyAmenities: nearbyAmenities.join(", ") || "N/A",
        availableFrom: doc.availableFrom
          ? new Date(doc.availableFrom).toISOString()
          : null,
      };
    });

  try {
    let vectorSearchAdded = false;
    let vectorStage: any | null = null;

    if (params.query) {
      try {
        const vector = await generateEmbedding(params.query);
        // Try Mongo Atlas-compatible vector search operator inside $search.
        vectorStage = {
          $search: {
            vectorSearch: {
              path: "embedding",
              queryVector: vector,
              numCandidates: Math.max(resultLimit * 5, 50),
              limit: oversampleLimit,
            },
          },
        };
        vectorSearchAdded = true;
      } catch (error: any) {
        console.warn("[Tools] Embedding unavailable, using structured/text fallback", {
          reason: error?.message,
        });
      }
    }

    let queryBranchResults: any[] = [];
    if (hasQuery) {
      try {
        queryBranchResults = await runQueryBranch({
          useVector: vectorSearchAdded,
          broadenText: false,
          vectorStage,
        });
      } catch (searchError: any) {
        console.warn(
          "[Tools] Query vector branch failed, retrying with text branch",
          {
            reason: searchError?.message,
          }
        );

        queryBranchResults = await runQueryBranch({
          useVector: false,
          broadenText: false,
        });
      }
    }

    const filterBranchResults = await runFilterBranch({ relaxed: false });
    const primaryUnion = dedupeAndTrim([
      ...queryBranchResults,
      ...filterBranchResults,
    ]);

    console.log("[Tools] Hybrid search primary union", {
      queryResults: queryBranchResults.length,
      filterResults: filterBranchResults.length,
      mergedResults: primaryUnion.length,
    });

    if (primaryUnion.length > 0) {
      return transformResults(primaryUnion);
    }

    const broadenedQueryResults = hasQuery
      ? await runQueryBranch({ useVector: false, broadenText: true })
      : [];
    const relaxedFilterResults = await runFilterBranch({ relaxed: true });

    const broadenedUnion = dedupeAndTrim([
      ...broadenedQueryResults,
      ...relaxedFilterResults,
    ]);

    console.log("[Tools] Hybrid search broadened union", {
      broadenedQueryResults: broadenedQueryResults.length,
      relaxedFilterResults: relaxedFilterResults.length,
      mergedResults: broadenedUnion.length,
    });

    return transformResults(broadenedUnion);
  } catch (error: any) {
    console.error("Property search error:", error);
    return [];
  }
}

/**
 * Quick city-level inventory check.
 * Returns whether any listings exist for the given city and how many,
 * using a 5-minute in-memory cache to avoid redundant DB hits.
 *
 * Used by the agent's inventory-first strategy: before asking the user
 * for BHK / budget requirements, the agent probes via property_search
 * with city-only filters (maxResults: 3). This helper is used internally
 * by voice.controller and can be used in future middleware.
 */
export async function checkCityAvailability(
  city: string,
): Promise<{ hasListings: boolean; count: number }> {
  const cached = getCityCacheEntry(city);
  if (cached) {
    console.log(`[CityCache] HIT for city "${city}":`, cached);
    return { hasListings: cached.hasListings, count: cached.count };
  }

  const mongooseConnection = mongoose.connection;
  if (!mongooseConnection.db) {
    return { hasListings: false, count: 0 };
  }

  try {
    const db = mongooseConnection.db;
    const count = await db.collection("listings").countDocuments({
      "location.city": { $regex: new RegExp(`^${city.trim()}$`, "i") },
    });

    const result = { hasListings: count > 0, count };
    setCityCacheEntry(city, result);
    console.log(`[CityCache] MISS for city "${city}", counted ${count} listings, cached.`);
    return result;
  } catch (err: any) {
    console.warn(`[CityCache] Count query failed for city "${city}":`, err?.message);
    return { hasListings: false, count: 0 };
  }
}

/**
 * Build MongoDB filter object from agent-provided filters
 */
function buildMongoDbFilters(filters: Record<string, any>): Record<string, any> {
  const mongoFilters: Record<string, any> = {};

  if (Array.isArray(filters.bhk)) {
    mongoFilters["metadata.bhk"] = { $in: filters.bhk };
  } else if (filters.bhk) {
    mongoFilters["metadata.bhk"] = filters.bhk;
  }

  if (filters.budgetMin || filters.budgetMax) {
    const priceRange: Record<string, number> = {};
    if (filters.budgetMin) {
      priceRange["$gte"] = filters.budgetMin;
    }
    if (filters.budgetMax) {
      priceRange["$lte"] = filters.budgetMax;
    }
    mongoFilters["$or"] = [
      { "metadata.price": priceRange },
      { "metadata.price": { $exists: false } },
      { "metadata.price": null },
      { "metadata.price": 0 },
    ];
  }

  if (filters.locality) {
    mongoFilters["location.locality"] = {
      $regex: new RegExp(`^${filters.locality.trim()}$`, "i"),
    };
  }

  if (filters.city) {
    mongoFilters["location.city"] = {
      $regex: new RegExp(`^${filters.city.trim()}$`, "i"),
    };
  }

  if (Array.isArray(filters.listing_type)) {
    mongoFilters["metadata.listing_type"] = {
      $in: filters.listing_type.map((value: string) => new RegExp(`^${escapeRegex(String(value).trim())}$`, "i")),
    };
  } else if (filters.listing_type) {
    mongoFilters["metadata.listing_type"] = {
      $regex: new RegExp(`^${escapeRegex(String(filters.listing_type).trim())}$`, "i"),
    };
  }

  if (filters.project_id) {
    try {
      mongoFilters["projectId"] = new mongoose.Types.ObjectId(filters.project_id);
    } catch {
      // Ignore invalid project id filters so search remains resilient.
    }
  }

  if (filters.project_title) {
    mongoFilters["project.title"] = {
      $regex: new RegExp(filters.project_title.trim(), "i"),
    };
  }

  if (filters.suitability && filters.suitability.length > 0) {
    mongoFilters["metadata.suitability"] = { $in: filters.suitability };
  }

  return mongoFilters;
}

function normalizeSearchFilters(filters: Record<string, any>): Record<string, any> {
  const normalized = { ...filters };
  const locality = typeof normalized.locality === "string" ? normalized.locality.trim() : "";
  const city = typeof normalized.city === "string" ? normalized.city.trim() : "";

  if (/^navi(?:\s+mumbai)?$/i.test(locality) && (!city || /^mumbai$/i.test(city))) {
    normalized.city = "Navi Mumbai";
    delete normalized.locality;
  }

  const listingTypeValues = normalized.listing_type
    ? (Array.isArray(normalized.listing_type)
      ? normalized.listing_type
      : [normalized.listing_type])
    : [];
  const validListingTypes = listingTypeValues.filter((value: unknown) =>
    /^(buy|rent)$/i.test(String(value).trim()),
  );

  if (listingTypeValues.length > 0 && validListingTypes.length === 0) {
    delete normalized.listing_type;
  } else if (Array.isArray(normalized.listing_type)) {
    normalized.listing_type = validListingTypes;
  }

  return normalized;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const propertySearchTool = tool(
  async (input) => {
    try {
      console.log(`[Tool: property_search] Executing with input:`, JSON.stringify(input));
      const results = await hybridPropertySearch({
        query: input.query,
        filters: input.filters,
        maxResults: input.maxResults,
        excludeIds: input.excludeIds,
      });
      console.log(`[Tool: property_search] Found ${results.length} properties.`);
      
      if (input.isInventoryProbe) {
        console.log(`[Tool: property_search] isInventoryProbe=true, aggregating facets.`);
        const uniqueBhks = Array.from(new Set(results.map(r => r.bhk).filter(b => typeof b === 'number' && b > 0))).sort((a, b) => a - b);
        const uniqueLocalities = Array.from(new Set(results.map(r => r.locality).filter(Boolean)));
        const uniquePropertyTypes = Array.from(new Set(results.map(r => r.propertyType).filter(Boolean)));

        const probeResult = {
          count: results.length,
          hasListings: results.length > 0,
          availableBhks: uniqueBhks,
          localities: uniqueLocalities,
          propertyTypes: uniquePropertyTypes,
        };

        return JSON.stringify(probeResult);
      }
      
      // We return JSON string so LangChain can serialize it easily, or just array
      return JSON.stringify(results);
    } catch (e: any) {
      console.error(`[Tool: property_search] Error:`, e.message);
      return `Failed to search properties: ${e.message}`;
    }
  },
  {
    name: "property_search",
    description: "Search for real estate properties based on text queries or structured filters like budget, bhk, locality, city.",
    schema: z.object({
      query: z.string().optional().describe("Free-form text query, e.g. '3 BHK near metro' or 'luxurious villa'"),
      filters: z.object({
        bhk: z.union([z.number(), z.array(z.number())]).optional().describe("Number of bedrooms, e.g. 2, 3"),
        budgetMin: z.number().optional().describe("Minimum budget in INR"),
        budgetMax: z.number().optional().describe("Maximum budget in INR"),
        locality: z.string().optional().describe("Specific locality or area"),
        city: z.string().optional().describe("City name"),
        listing_type: z.union([z.string(), z.array(z.string())]).optional().describe("'Buy' or 'Rent'"),
        suitability: z.array(z.string()).optional().describe("E.g. 'Family', 'Bachelors', 'Investment'"),
      }).optional().describe("Structured filters to refine the search"),
      maxResults: z.number().optional().describe("Maximum number of results to return (default 10)"),
      excludeIds: z.array(z.string()).optional().describe("List of Property IDs to exclude from search results"),
      isInventoryProbe: z.boolean().optional().describe("CRITICAL: Set to true if this is a silent inventory probe (e.g. checking city availability before asking for BHK/budget). When true, returns ONLY a count, physically preventing property cards from displaying prematurely."),
    }),
  }
);

/**
 * Tool: Get all cities that have at least one listing in the database.
 * Used when the user asks "which cities do you have?" or similar.
 * Runs a distinct query — never hallucinate city names from general knowledge.
 */
export const getAvailableCitiesTool = tool(
  async () => {
    try {
      const mongooseConnection = mongoose.connection;
      if (!mongooseConnection.db) {
        return JSON.stringify({ cities: [], error: "Database not connected" });
      }
      const cities: string[] = await mongooseConnection.db
        .collection("listings")
        .distinct("location.city");

      const sorted = cities
        .filter(Boolean)
        .map((c) => String(c).trim())
        .filter((c) => c.length > 0)
        .sort();

      console.log(`[Tool: get_available_cities] Found ${sorted.length} cities:`, sorted);
      return JSON.stringify({ cities: sorted });
    } catch (e: any) {
      console.error(`[Tool: get_available_cities] Error:`, e.message);
      return JSON.stringify({ cities: [], error: e.message });
    }
  },
  {
    name: "get_available_cities",
    description: `Returns the exact list of cities that have active property listings in the database.

WHEN TO CALL THIS (mandatory, not optional):
- Immediately after any property_search probe returns 0 results — before responding to the user.
- Whenever the user asks "which cities do you have?", "where are you available?", "do you have anywhere else?"

FORBIDDEN behavior (never do this instead of calling this tool):
- Do NOT suggest Bangalore, Hyderabad, Delhi, Pune, Goa, or any other city from your training knowledge.
- Do NOT run property_search probes for cities you thought of yourself.
- Do NOT say "We are available in Mumbai, Bangalore..." without calling this tool first.

CORRECT flow when a city has no results:
  1. Call get_available_cities.
  2. Read the { cities } list.
  3. Tell the user which cities from that list are available.

Returns: { cities: string[] }`,
    schema: z.object({}),
  }
);

