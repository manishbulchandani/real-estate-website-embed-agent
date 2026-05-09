import { defineAgent, inference, llm, voice } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import axios from "axios";
import { z } from "zod";
import { env } from "../../config/env.config";

type PropertyRecord = {
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
  ai_pitch?: string;
};

const toList = (value: unknown): unknown[] => Array.isArray(value) ? value : [value];

const appendFilterText = (parts: string[], label: string, value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return;
  }
  parts.push(`${label} ${toList(value).join(" or ")}`);
};

const buildVoiceSearchPayload = (args: {
  query?: string;
  filters?: Record<string, unknown>;
  maxResults?: number;
  excludeIds?: string[];
}) => {
  const filters = args.filters ?? {};
  const queryParts = [args.query?.trim()].filter(Boolean) as string[];

  appendFilterText(queryParts, "BHK", filters.bhk);
  appendFilterText(queryParts, "budget up to", filters.budgetMax);
  appendFilterText(queryParts, "budget from", filters.budgetMin);
  appendFilterText(queryParts, "in", filters.locality);
  appendFilterText(queryParts, "city", filters.city);
  appendFilterText(queryParts, "for", filters.listing_type);
  appendFilterText(queryParts, "suitable for", filters.suitability);

  return {
    ...args,
    query: queryParts.join(" ").trim() || args.query,
  };
};

/**
 * Real estate voice agent that handles property recommendations in voice mode.
 * Runs as part of the Express backend.
 */
export class RealEstateVoiceAgent extends voice.Agent {
  constructor(tools: llm.ToolContext) {
    super({
      instructions: `You are Rahul, a friendly and professional real estate voice advisor. 

Your behavior:
1. Be conversational, warm, and human-like. Ask one question at a time.
2. Do NOT list properties verbally. When you find properties, call display_recommended_properties so the UI shows cards.
3. Keep replies natural and concise - no long monologues.
4. Use plain spoken language without markdown or formatting.
5. When discussing a previously recommended property, use available context to answer questions clearly.
6. If user says something like "show properties" or "what did you recommend", refer to what's on screen.`,
      tools,
    });
  }
}

/**
 * Define the LiveKit agent that will be spawned for each voice session.
 * This is the entry point registered with LiveKit infrastructure.
 */
export const voiceAgentDefinition = defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx) => {
    
    const recommendedById = new Map<string, PropertyRecord>();
    const encoder = new TextEncoder();

    // Property search tool - queries backend recommendations endpoint
    const propertySearchTool = llm.tool({
      description:
        "Search for properties using natural language query and/or structured filters (city, locality, BHK, budget range).",
      parameters: z.object({
        query: z.string().optional(),
        filters: z
          .object({
            bhk: z.union([z.number(), z.array(z.number())]).optional(),
            budgetMin: z.number().optional(),
            budgetMax: z.number().optional(),
            locality: z.string().optional(),
            city: z.string().optional(),
            listing_type: z.union([z.string(), z.array(z.string())]).optional(),
            suitability: z.array(z.string()).optional(),
          })
          .optional(),
        maxResults: z.number().min(1).max(20).optional(),
        excludeIds: z.array(z.string()).optional(),
      }),
      execute: async (args) => {
        try {
          const searchPayload = buildVoiceSearchPayload(args);
          const apiUrl = `http://localhost:${env.PORT}/api/v1/voice/recommendations`;
          
          const response = await axios.post(apiUrl, searchPayload, { timeout: 15000 });
          const properties = (response.data?.properties ?? []) as PropertyRecord[];

          // Cache properties so we can enrich them later
          for (const property of properties) {
            recommendedById.set(property.id, property);
          }

          const result = {
            properties: properties.map((p) => ({
              id: p.id,
              title: p.title,
              locality: p.locality,
              city: p.city,
              price: p.price,
              bhk: p.bhk,
              images: p.images?.slice(0, 2),
            })),
          };
          
          return result;
        } catch (error) {
          console.error("Property search failed:", error);
          return { properties: [], error: "Could not fetch properties" };
        }
      },
    });

    // Display properties tool - publishes recommendations to frontend via data channel
    const displayPropertiesToolTool = llm.tool({
      description:
        "Display selected property recommendations on screen. Call this after property_search.",
      parameters: z.object({
        properties: z.array(
          z.object({
            id: z.string(),
            ai_pitch: z
              .string()
              .describe("Why this property matches the user's needs"),
          }),
        ),
      }),
      execute: async ({ properties }) => {
        const enriched = properties
          .map((item) => {
            const found = recommendedById.get(item.id);
            if (!found) return null;
            return { ...found, ai_pitch: item.ai_pitch };
          })
          .filter((item): item is (PropertyRecord & { ai_pitch: string }) => Boolean(item));

        if (enriched.length > 0 && ctx.room) {
          try {
            await ctx.room.localParticipant?.publishData(
              encoder.encode(
                JSON.stringify({
                  type: "voice_properties",
                  properties: enriched,
                }),
              ),
              {
                reliable: true,
                topic: "property_recommendations",
              },
            );
          } catch (error) {
            console.error("Failed to publish properties:", error);
          }
        }

        return { delivered: enriched.length };
      },
    });

    const agent = new RealEstateVoiceAgent({
      property_search: propertySearchTool,
      display_recommended_properties: displayPropertiesToolTool,
    });

    const vad = ctx.proc.userData.vad as silero.VAD;



    const session = new voice.AgentSession({
      vad,
      stt: new inference.STT({ model: "deepgram/nova-3", language: "multi" }),
      llm: new inference.LLM({ model: "google/gemini-2.5-flash" }),
      tts: new inference.TTS({
        model: "elevenlabs/eleven_flash_v2_5",
        ...(env.ELEVENLABS_VOICE_ID && { voice: env.ELEVENLABS_VOICE_ID }),
      }),
      turnHandling: {
        turnDetection: "vad",
        interruption: {
          mode: "vad",
          minDuration: 1200,
          minWords: 1,
        },
        endpointing: {
          mode: "fixed",
          minDelay: 700,
          maxDelay: 2500,
        },
        preemptiveGeneration: {
          enabled: false,
        },
      },
      maxRetries: 2,
    });

    await session.start({
      room: ctx.room,
      agent,
    });

    await ctx.connect();

    await session.generateReply({
      instructions:
        "Greet the user naturally, introduce yourself as Rahul (their property advisor), and ask what kind of property they are looking for.",
    });
  },
});
