import { defineAgent, llm, voice } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import * as openai from "@livekit/agents-plugin-openai";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import axios from "axios";
import mongoose from "mongoose";
import { ChatSession } from "../agent/models/chatSession.model";
import { z } from "zod";
import { env } from "../../config/env.config";
import connectDB from "../../config/db.config";
import { hybridPropertySearch } from "../agent/tools/hybridPropertySearch.tool";

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

const buildVoiceSearchPayload = (args: any) => {
  const filters = {
    ...(args.filters ?? {}),
    ...(args.city !== undefined && { city: args.city }),
    ...(args.bhk !== undefined && { bhk: args.bhk }),
    ...(args.budgetMin !== undefined && { budgetMin: args.budgetMin }),
    ...(args.budgetMax !== undefined && { budgetMax: args.budgetMax }),
    ...(args.locality !== undefined && { locality: args.locality }),
    ...(args.listing_type !== undefined && { listing_type: args.listing_type }),
    ...(args.suitability !== undefined && { suitability: args.suitability }),
  };

  const queryParts = [args.query?.trim()].filter(Boolean) as string[];

  appendFilterText(queryParts, "BHK", filters.bhk);
  appendFilterText(queryParts, "budget up to", filters.budgetMax);
  appendFilterText(queryParts, "budget from", filters.budgetMin);
  appendFilterText(queryParts, "in", filters.locality);
  appendFilterText(queryParts, "city", filters.city);
  appendFilterText(queryParts, "for", filters.listing_type);
  appendFilterText(queryParts, "suitable for", filters.suitability);

  return {
    query: queryParts.join(" ").trim() || args.query,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    maxResults: args.maxResults,
    excludeIds: args.excludeIds,
  };
};

/**
 * Real estate voice agent that handles property recommendations in voice mode.
 * Runs as part of the Express backend.
 */
interface LanguageConfig {
  name: string;
  greeting: string;
  systemInstruction: string;
  // STT language code: hi-Latn = Hindi phonetics in Roman script (perfect for Hinglish)
  // en-IN = Indian English, mr = Marathi
  sttLanguage: string;
  // ElevenLabs TTS language code
  ttsLanguage: string;
}

export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  Hinglish: {
    name: "Hinglish (Hindi + English)",
    greeting: "नमस्ते! मैं Shriya हूँ, आपकी virtual real estate assistant. मैं आपकी कैसे मदद कर सकती हूँ?",
    systemInstruction: `Respond in natural Hinglish: Hindi words in Devanagari (e.g. नमस्ते, मैं, हूँ, है) and English words in English script (options, available, property, BHK). Never write Hindi words in Roman letters.
Good example: "Navi Mumbai में हमारे पास कुछ options available हैं। आप कितने BHK की property देख रहे हैं?"`,
    sttLanguage: "hi",      // Deepgram hi = Hindi, handles Hinglish speech well with nova-2-general
    ttsLanguage: "hi",
  },
  English: {
    name: "English",
    greeting: "Hello! I am Shriya, your virtual real estate assistant. How can I help you today?",
    systemInstruction: `Respond entirely in natural, conversational English. No Hindi or Marathi words.`,
    sttLanguage: "en-IN",   // Indian English variant - handles Indian accents and proper nouns better
    ttsLanguage: "en",
  },
  Marathi: {
    name: "Marathi + English",
    greeting: "नमस्कार! मी Shriya आहे, तुमची virtual real estate assistant. मी तुम्हाला कशी मदत करू शकते?",
    systemInstruction: `Respond in natural Marathi mixed with English: Marathi words in Devanagari (e.g. नमस्कार, मी, आहे) and English words in English script (options, available, property, BHK). Never write Marathi words in Roman letters.
Good example: "Navi Mumbai मध्ये आमच्याकडे काही options available आहेत. आपण किती BHK ची property पाहत आहात?"`,
    sttLanguage: "mr",
    ttsLanguage: "hi",      // ElevenLabs does not have separate Marathi model; hi is closest
  },
};

// Deepgram keyword boosting for Indian real estate domain.
// Weighted tuples: [term, boost]. Boost 10-15 forces the acoustic model to prefer these terms.
// This directly solves misrecognitions like "four GHK" → "4 BHK", "लवई" → "Navi".
const STT_KEYWORDS: [string, number][] = [
  // BHK variants
  ["BHK", 15], ["1BHK", 15], ["2BHK", 15], ["3BHK", 15], ["4BHK", 15],
  ["1 BHK", 15], ["2 BHK", 15], ["3 BHK", 15], ["4 BHK", 15],
  // Navi Mumbai localities
  ["Navi Mumbai", 15], ["Mumbai", 10],
  ["Airoli", 15], ["Seawoods", 15], ["Kharghar", 15], ["Vashi", 15],
  ["Nerul", 15], ["Panvel", 15], ["Belapur", 15], ["Ghansoli", 15],
  ["Koparkhairane", 15], ["Kamothe", 15], ["Taloja", 15], ["Ulwe", 15],
  ["Sanpada", 15], ["Juinagar", 15], ["CBD Belapur", 15], ["Seawoods Darave", 15],
  ["Dronagiri", 15],
  // Mumbai localities
  ["Thane", 12], ["Mulund", 12], ["Bhandup", 12], ["Ghatkopar", 12],
  ["Kurla", 12], ["Chembur", 12], ["Dadar", 12], ["Bandra", 12],
  ["Andheri", 12], ["Borivali", 12], ["Kalyan", 12], ["Dombivli", 12],
  // Property types
  ["flat", 10], ["flats", 10], ["apartment", 10], ["penthouse", 12],
  ["villa", 12], ["villas", 12], ["studio", 10], ["row house", 12],
  ["duplex", 12], ["builder floor", 12],
  // Finance
  ["crore", 12], ["lakh", 12], ["lakhs", 12], ["EMI", 12],
  ["RERA", 12], ["sqft", 12], ["sq ft", 12], ["square feet", 12],
  // Intents
  ["possession", 10], ["ready to move", 10], ["under construction", 10],
  ["shortlist", 10], ["book visit", 10], ["site visit", 10],
  // Agent name
  ["Shriya", 15],
];



export class RealEstateVoiceAgent extends voice.Agent {
  constructor(instructions: string, tools: llm.ToolContext) {
    super({
      instructions,
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
    // Tuned VAD:
    // - activationThreshold 0.6: rejects background noise (higher = more selective)
    // - minSpeechDuration 0.1: minimum speech burst to count (prevents click triggers)
    // - minSilenceDuration 0.55: wait 550ms of silence before marking speech as ended
    //   (Hindi/Marathi speakers naturally pause; too short cuts them off mid-sentence)
    // - prefixPaddingDuration 0.3: capture 300ms before speech was detected (no clipped words)
    proc.userData.vad = await silero.VAD.load({
      activationThreshold: 0.7, // Increased from 0.6 to ignore more background static
      minSpeechDuration: 0.15,  // Increased from 0.1 to avoid click triggers keeping turns open
      minSilenceDuration: 0.60,
      prefixPaddingDuration: 0.3,
    });
  },
  entry: async (ctx) => {
    if (mongoose.connection.readyState === 0) {
      await connectDB();
    }

    let resolvedSessionId: string | undefined;
    const recommendedById = new Map<string, PropertyRecord>();
    const encoder = new TextEncoder();

    // Resolve language and sessionId from room name pattern: voice-{Lang}-{sessionId}
    const roomName = ctx.job.room?.name || ctx.room?.name;
    let language = "Hinglish"; // default
    if (roomName && typeof roomName === "string") {
      const match = String(roomName).match(/^voice-(Hinglish|English|Marathi|.+?)-(.+)$/);
      if (match) {
        language = match[1];
        resolvedSessionId = match[2];
      } else {
        const fallbackMatch = String(roomName).match(/^voice-(.+)$/);
        if (fallbackMatch) resolvedSessionId = fallbackMatch[1];
      }
    }

    console.log(`[Voice Agent] entry triggered. roomName: "${roomName}", language: "${language}", sessionId: "${resolvedSessionId}"`);

    const langConfig = LANGUAGE_CONFIGS[language] || LANGUAGE_CONFIGS.Hinglish;

    let aiPitchInstruction = "";
    if (language === "English") {
      aiPitchInstruction = "The ai_pitch for every property must be strictly in English only (e.g. 'This property is in Kharghar, very spacious and close to the metro.'). Use actual digits for numbers (e.g. '2 BHK', NOT 'two BHK').";
    } else if (language === "Marathi") {
      aiPitchInstruction = "The ai_pitch for every property MUST BE WRITTEN IN MARATHI-ENGLISH MIX (Marathi words written using the English/Roman alphabet) — never Devanagari and never pure English. Example: 'He property Kharghar madhye ahe, khup spacious ahe ani metro javal ahe.' Use actual digits for numbers (e.g. '2 BHK', NOT 'two BHK').";
    } else {
      aiPitchInstruction = "The ai_pitch for every property MUST BE WRITTEN IN HINGLISH (Hindi words written using the English/Roman alphabet) — never Devanagari and never pure English. Example: 'Yeh property Kharghar mein hai, very spacious aur metro ke paas.' Use actual digits for numbers (e.g. '2 BHK', NOT 'two BHK').";
    }

    // Language-specific spoken formatting rules
    let spokenLanguageRules = "";
    if (language === "English") {
      spokenLanguageRules = `
- Write your entire response in natural English (Latin script).
- Numbers must ALWAYS be spelled out as English words (e.g. "one", "two", "three", "four") instead of digits (e.g. "1", "2").`;
    } else if (language === "Marathi") {
      spokenLanguageRules = `
- Write Marathi words strictly in Devanagari script.
- Write English words (such as options, available, property, BHK, city names like Navi Mumbai, Airoli, etc.) strictly in English/Latin script.
- CRITICAL: Never mix English and Devanagari letters in a single word (e.g. never write 'oNप्रशंस' or 'ऑप्शंस'). Keep English words completely in Latin script (e.g. 'options') and Marathi words completely in Devanagari.
- Numbers must ALWAYS be written as Marathi words in Devanagari script (e.g. "एक", "दोन", "तीन", "चार", "पाच", "सहा") instead of digits (e.g. "1", "2") or English words (e.g. "one", "two").`;
    } else {
      spokenLanguageRules = `
- Write Hindi words strictly in Devanagari script.
- Write English words (such as options, available, property, BHK, city names like Navi Mumbai, Airoli, etc.) strictly in English/Latin script.
- CRITICAL: Never mix English and Devanagari letters in a single word (e.g. never write 'oNप्रशंस' or 'ऑप्शंस'). Keep English words completely in Latin script (e.g. 'options') and Hindi words completely in Devanagari.
- Numbers must ALWAYS be written as Hindi words in Devanagari script (e.g. "एक", "दो", "तीन", "चार", "पाँच", "छह") instead of digits (e.g. "1", "2") or English words (e.g. "one", "two").`;
    }

    // ── SYSTEM PROMPT ────────────────────────────────────────────────────────
    // Kept deliberately SHORT. Long prompts cause Gemini to over-reason and
    // create conflicting rule prioritization. Each rule here is a hard constraint.
    const instructions = `You are Shriya, a warm, professional real estate voice advisor. Help users find suitable homes through natural conversation.

LANGUAGE & TONE FOR SPOKEN RESPONSES (NON-NEGOTIABLE):
- These rules apply ONLY to your spoken conversation/messages, NOT to the ai_pitch text.
- ${langConfig.systemInstruction}
${spokenLanguageRules}
- TONE: Use an active, warm, lively, and enthusiastic conversational tone. Avoid passive, stiff, or robotic phrasing. Instead of saying passive things like "मैं चेक कर रही हूँ..." (I am checking), use active, natural, and energetic phrasing (e.g. "ठीक है, एक सेकंड रुकिए, मैं तुरंत चेक करती हूँ!", "बिल्कुल, मैं अभी आपके लिए बेस्ट ऑप्शंस देखती हूँ!", "Sure, let me check that for you right away!").
- Keep sentences under 12 words — this is spoken audio.
- Plain text only. No emojis, no markdown, no asterisks, no exclamation marks, no lists.
- Never output reasoning or internal monologue. Start directly with your spoken words.

MANDATORY FILLER PHRASES (CRITICAL VOICE RULE):
You are a voice agent. Dead silence during tool calls is a critical failure.
Whenever you decide to call the property_search tool, you MUST first output a short, warm filler sentence (AS PLAIN TEXT) BEFORE you emit the tool call JSON.
CRITICAL: This filler sentence MUST be dynamically generated, context-aware, and spoken in the EXACT SAME LANGUAGE, script, and tone as the conversation (e.g., if the user speaks Hindi, say something naturally like "जी, मैं Navi Mumbai के लिए options चेक कर रही हूँ..."). NEVER mix English and Devanagari characters in a single word.
DO NOT put the filler phrase inside the tool parameters. You must speak it in the main conversation flow before the tool executes.

SEARCH STRATEGY (follow strictly):
1. The moment a user mentions a city, call property_search(city, isInventoryProbe:true, maxResults:3). REMEMBER THE FILLER.
2. If probe returns count>0: say options exist, ask ONE follow-up question (BHK or budget, not both).
3. If probe returns count=0: do NOT ask for BHK or budget. Tell user no listings there, suggest other available cities.
4. Once BHK or budget is known: call property_search with those filters (non-probe), then call display_recommended_properties.
5. REUSE CONTEXT: before re-searching, check conversation history for matching results.

DISPLAY & PROPERTY CARD RULE (FOR SCREEN ONLY):
- Call display_recommended_properties only for non-probe results.
- The 'ai_pitch' field inside display_recommended_properties is displayed on the user's screen. It is NOT spoken.
- For 'ai_pitch', do NOT follow the spoken response rules (meaning you must write in Roman script and use digits for numbers), but you MUST strictly follow the language style instruction below:
- ${aiPitchInstruction}

VISIT REQUEST FLOW:
- Suggest a site visit request when the user shows strong interest.
- Gather the required details naturally, one at a time: property name, preferred date, preferred time slot, user's name, and phone number.
- PHONE CONFIRMATION: Once the user provides their phone number, briefly repeat and confirm it (e.g., "Just to confirm, your phone number is [number], right?").
- Once the phone number is confirmed, call the 'book_visit' tool to submit the visit request.
- POST-SUBMISSION: Inform the user that their visit request has been submitted, and our team will reach out to them on WhatsApp with further updates to coordinate the final schedule.

CLOSURE & SIGN-OFF:
- After executing a tool or completing a task (such as submitting a visit request), do not end the conversation abruptly.
- Always ask the user if they need any further help (e.g. "क्या मैं आपके लिए कुछ और मदद कर सकती हूँ?" in Hindi/Marathi, or "Is there anything else I can help you with today?" in English).
- Close the conversation with a warm, polite sign-off (e.g. "आपका दिन बहुत शुभ रहे!" in Hindi/Marathi, or "Have a wonderful day ahead!" in English).

KNOWLEDGE & PERSONA:
- Use your internal knowledge to answer real estate questions even if the DB lacks info.
- For demo purposes: generate realistic dummy answers for possession dates, RERA numbers, amenity details if not available.
- Ask only ONE question at a time to keep it natural.`;

    // ── TOOLS ─────────────────────────────────────────────────────────────────

    const propertySearchTool = llm.tool({
      description: "Search for properties with filters. For city-only checks use isInventoryProbe:true. For full search with BHK/budget, omit isInventoryProbe.",
      parameters: z.object({
        query: z.string().optional().describe("Free-form text query e.g. '3 BHK near metro'"),
        filters: z.object({
          bhk: z.union([z.number(), z.array(z.number())]).optional().describe("Number of bedrooms"),
          budgetMin: z.number().optional().describe("Minimum budget in INR"),
          budgetMax: z.number().optional().describe("Maximum budget in INR"),
          locality: z.string().optional().describe("Specific locality"),
          city: z.string().optional().describe("City name"),
          listing_type: z.union([z.string(), z.array(z.string())]).optional().describe("Buy or Rent"),
          suitability: z.array(z.string()).optional().describe("Family, Bachelors, Investment"),
        }).optional(),
        maxResults: z.number().min(1).max(20).optional(),
        excludeIds: z.array(z.string()).optional(),
        isInventoryProbe: z.boolean().optional().describe("Set true to check city inventory only. Returns count+BHK summary, no cards."),
      }),
      execute: async (args) => {
        try {
          console.log(`[Voice Agent] property_search triggered.`);
          console.time(`[Voice Agent] property_search duration (${args.query || 'probe'})`);

          const searchPayload = buildVoiceSearchPayload(args);
          const rawProperties = await hybridPropertySearch({
            query: searchPayload.query,
            filters: searchPayload.filters,
            maxResults: searchPayload.maxResults || 10,
            excludeIds: searchPayload.excludeIds,
          });
          
          const properties = (rawProperties ?? []) as PropertyRecord[];
          console.timeEnd(`[Voice Agent] property_search duration (${args.query || 'probe'})`);
          console.log(`[Voice Agent] property_search found ${properties.length} results.`);

          for (const property of properties) {
            recommendedById.set(property.id, property);
          }

          if (args.isInventoryProbe) {
            const uniqueBhks = Array.from(new Set(properties.map(r => r.bhk).filter(b => typeof b === "number" && b > 0))).sort((a, b) => a - b);
            const uniqueLocalities = Array.from(new Set(properties.map(r => r.locality).filter(Boolean)));
            const uniquePropertyTypes = Array.from(new Set(properties.map(r => r.propertyType).filter(Boolean)));
            return {
              count: properties.length,
              hasListings: properties.length > 0,
              availableBhks: uniqueBhks,
              localities: uniqueLocalities,
              propertyTypes: uniquePropertyTypes,
            };
          }

          return {
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
        } catch (error) {
          console.error("Property search failed:", error);
          return { properties: [], error: "Could not fetch properties" };
        }
      },
    });

    const displayPropertiesToolTool = llm.tool({
      description: `Display property recommendations on screen. Call this after a non-probe property_search. ${aiPitchInstruction}`,
      parameters: z.object({
        properties: z.array(
          z.object({
            id: z.string(),
            ai_pitch: z.string().describe(`1-2 sentence pitch for the property. ${aiPitchInstruction}`),
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
              encoder.encode(JSON.stringify({ type: "voice_properties", properties: enriched })),
              { reliable: true, topic: "property_recommendations" },
            );
          } catch (error) {
            console.error("Failed to publish properties:", error);
          }
        }

        return { delivered: enriched.length };
      },
    });

    const bookVisitTool = llm.tool({
      description: `Book a site visit. Gather ALL of: propertyId, propertyName, date, timeSlot, userName, userPhone before calling.`,
      parameters: z.object({
        propertyId: z.string(),
        propertyName: z.string(),
        date: z.string().describe("Preferred visit date"),
        timeSlot: z.string().describe("Preferred time e.g. 11:00 AM or Morning"),
        userName: z.string(),
        userPhone: z.string(),
      }),
      execute: async (args) => {
        const bookingId = "BK-" + Math.floor(1000 + Math.random() * 9000);
        const booking = { ...args, bookingId, status: "Confirmed" as const };

        if (ctx.room) {
          try {
            await ctx.room.localParticipant?.publishData(
              encoder.encode(JSON.stringify({ type: "voice_booking", booking })),
              { reliable: true, topic: "property_recommendations" },
            );
          } catch (e) {
            console.error("Failed to publish booking data:", e);
          }
        }

        if (resolvedSessionId) {
          try {
            await ChatSession.findOneAndUpdate(
              { sessionId: resolvedSessionId },
              {
                $setOnInsert: { sessionId: resolvedSessionId },
                $push: { messages: { id: crypto.randomUUID(), sender: "agent", type: "booking", data: booking } },
              },
              { upsert: true }
            ).exec();
          } catch (dbErr) {
            console.error("[Voice] Failed to save booking:", dbErr);
          }
        }

        return booking;
      },
    });

    const managePreferenceToolTool = llm.tool({
      description: "Shortlist or mark a property as not interested based on user feedback.",
      parameters: z.object({
        propertyId: z.string(),
        action: z.enum(["shortlist", "remove_shortlist", "not_interested", "remove_not_interested"]),
      }),
      execute: async (args) => {
        if (!resolvedSessionId) {
          return { error: "Cannot manage preference: sessionId missing." };
        }
        try {
          const session = await ChatSession.findOneAndUpdate(
            { sessionId: resolvedSessionId },
            { $setOnInsert: { sessionId: resolvedSessionId } },
            { upsert: true, new: true }
          );

          const updatedShortlist = new Set(session.shortlistedProperties || []);
          const updatedNotInterested = new Set(session.notInterestedProperties || []);

          if (args.action === "shortlist") {
            updatedShortlist.add(args.propertyId);
            updatedNotInterested.delete(args.propertyId);
          } else if (args.action === "remove_shortlist") {
            updatedShortlist.delete(args.propertyId);
          } else if (args.action === "not_interested") {
            updatedNotInterested.add(args.propertyId);
            updatedShortlist.delete(args.propertyId);
          } else if (args.action === "remove_not_interested") {
            updatedNotInterested.delete(args.propertyId);
          }

          session.shortlistedProperties = Array.from(updatedShortlist);
          session.notInterestedProperties = Array.from(updatedNotInterested);
          await session.save();

          if (ctx.room) {
            await ctx.room.localParticipant?.publishData(
              encoder.encode(JSON.stringify({
                type: "voice_preference_update",
                preferences: {
                  shortlistedProperties: session.shortlistedProperties,
                  notInterestedProperties: session.notInterestedProperties,
                },
              })),
              { reliable: true, topic: "property_preferences" },
            );
          }

          return { success: true, action: args.action, propertyId: args.propertyId };
        } catch (e) {
          console.error("Failed to manage property preference:", e);
          return { error: "Failed to manage property preference." };
        }
      },
    });

    const getAvailableCitiesTool = llm.tool({
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
      parameters: z.object({}),
      execute: async () => {
        try {
          const mongooseConnection = mongoose.connection;
          if (!mongooseConnection.db) {
            return { cities: [], error: "Database not connected" };
          }
          const cities = await mongooseConnection.db
            .collection("listings")
            .distinct("location.city");

          const sorted = cities
            .filter(Boolean)
            .map((c) => String(c).trim())
            .filter((c) => c.length > 0)
            .sort();

          console.log(`[Tool: get_available_cities] Found ${sorted.length} cities:`, sorted);
          return { cities: sorted };
        } catch (e: any) {
          console.error(`[Tool: get_available_cities] Error:`, e.message);
          return { cities: [], error: e.message };
        }
      },
    });

    const vad = ctx.proc.userData.vad as silero.VAD;
    let chatHistoryStr = "";

    const llmInstance = new openai.LLM({
      model: env.OPENROUTER_VOICE_MODEL,
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      temperature: 0.35,  // Slightly lower: more deterministic for tool calling
    });

    const session = new voice.AgentSession({
      vad,
      stt: (() => {
        if (env.STT_PROVIDER === "elevenlabs") {
          if (!env.ELEVENLABS_API_KEY) {
            throw new Error("ELEVENLABS_API_KEY is required when STT_PROVIDER is set to 'elevenlabs'");
          }
          // ElevenLabs Scribe realtime expects standard ISO-639-1 or ISO-639-3 language codes (e.g. 'en' instead of 'en-IN')
          const elevenLabsLanguage = langConfig.sttLanguage.startsWith("en") ? "en" : langConfig.sttLanguage;
          console.log(`[Voice Agent] Initializing ElevenLabs STT with model ${env.ELEVENLABS_STT_MODEL} and language ${elevenLabsLanguage}`);
          return new elevenlabs.STT({
            modelId: env.ELEVENLABS_STT_MODEL,
            apiKey: env.ELEVENLABS_API_KEY,
            languageCode: elevenLabsLanguage,
            keyterms: STT_KEYWORDS.map(([term]) => term),
          });
        } else {
          console.log("[Voice Agent] Initializing Deepgram STT");
          return new deepgram.STT({
            model: "nova-2-general",
            language: langConfig.sttLanguage,
            interimResults: true,
            smartFormat: true,
            noDelay: true,
            keywords: STT_KEYWORDS,
            apiKey: env.DEEPGRAM_API_KEY,
          });
        }
      })(),
      llm: llmInstance,
      tts: new elevenlabs.TTS({
        model: "eleven_flash_v2_5",
        apiKey: env.ELEVENLABS_API_KEY,
        voiceId: env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL", // Default to Sarah (female voice)
        language: langConfig.ttsLanguage,
        enableSsmlParsing: false,   // Prevent Devanagari chars from breaking TTS
      }),
      turnHandling: {
        turnDetection: "vad",
        interruption: {
          mode: "vad",
          minDuration: 500,   // 500ms of continuous speech needed to trigger interruption
          minWords: 2,        // At least 2 recognized words — prevents noise interruptions
        },
        endpointing: {
          mode: "fixed",
          // LiveKit-side endpointing (on top of Deepgram's):
          // 700ms min delay gives Hindi/Marathi speakers time for natural pauses.
          // 2500ms max prevents waiting too long on genuine sentence endings.
          minDelay: 700,
          maxDelay: 2500,
        },
        preemptiveGeneration: {
          enabled: false,     // Disabled: prevents LLM from starting before user finishes speaking
        },
      },
      userAwayTimeout: 10,    // Mark user as "away" after 10s of silence
    });



    // ── SESSION EVENT HANDLERS ─────────────────────────────────────────────

    session.on(voice.AgentSessionEventTypes.Error, (ev: any) => {
      const errorMsg = String(ev?.error?.message || ev?.error || "");
      console.error(`[Voice Agent] Session error: ${errorMsg}`);
    });

    let awayCount = 0;
    session.on(voice.AgentSessionEventTypes.UserStateChanged, async (ev: any) => {
      const newState = ev?.newState;
      if (newState === "away") {
        awayCount++;
        console.log(`[Voice Agent] User away (count: ${awayCount})`);

        if (awayCount === 1) {
          try {
            await session.generateReply({
              instructions: "The user has been silent for a while. Ask them warmly in one short sentence if they are still there or need help.",
            });
          } catch (e) {
            console.error("[Voice Agent] Failed to generate away follow-up:", e);
          }
        } else if (awayCount >= 2) {
          try {
            await session.generateReply({
              instructions: "The user has been away for a long time. Say a brief, warm goodbye in one sentence. Tell them they can come back anytime.",
            });
          } catch (e) {
            console.error("[Voice Agent] Failed to generate goodbye:", e);
          }
          setTimeout(() => {
            console.log("[Voice Agent] Disconnecting room after prolonged user absence.");
            ctx.room?.disconnect();
          }, 6000);
        }
      } else {
        if (awayCount > 0) {
          console.log(`[Voice Agent] User returned (was away ${awayCount} times). Resetting.`);
        }
        awayCount = 0;
      }
    });

    // ── START SESSION ──────────────────────────────────────────────────────

    await session.start({
      room: ctx.room,
      agent: new RealEstateVoiceAgent(instructions, {
        property_search: propertySearchTool,
        display_recommended_properties: displayPropertiesToolTool,
        book_visit: bookVisitTool,
        manage_preference: managePreferenceToolTool,
        get_available_cities: getAvailableCitiesTool,
      }),
    });

    await ctx.connect();

    // Load recent chat history after room connects (room metadata is available only post-connect)
    try {
      const metadataStr = ctx.room?.metadata || "{}";
      console.debug("[Voice] ctx.room.name:", ctx.room?.name, "metadata:", metadataStr);
      const metadata = JSON.parse(metadataStr);

      if (!resolvedSessionId) {
        resolvedSessionId = metadata.sessionId;
      }

      if (resolvedSessionId) {
        const chatSession = await ChatSession.findOne({ sessionId: resolvedSessionId }).lean().exec();
        const historyMessages = (chatSession?.messages ?? [])
          .filter((m) => m.type === "text" && typeof m.content === "string" && m.content.trim().length > 0)
          .slice(-10);

        if (historyMessages.length > 0) {
          chatHistoryStr = historyMessages
            .map((m) => `${m.sender === "user" ? "User" : "Agent"}: ${m.content}`)
            .join("\n");
        }

        console.debug("[Voice] Resolved sessionId:", resolvedSessionId, "loadedMessages:", historyMessages.length);
      } else {
        console.debug("[Voice] No sessionId found in room name or metadata.");
      }
    } catch (e) {
      console.error("[Voice] Failed to load chat history:", e);
    }

    const isResumeSession = chatHistoryStr.trim().length > 0;
    
    // Instead of generateReply which waits for the LLM, we use session.say to instantly speak
    // the moment the room connects, removing the perceived frontend loading delay.
    let greetingText = langConfig.greeting;
    if (isResumeSession) {
      if (language === "English") greetingText = "I am here, shall we continue?";
      else if (language === "Marathi") greetingText = "मी इथे आहे, आपण पुढे जाऊया का?";
      else greetingText = "हाँ, क्या हम आगे बढ़ें?";
    }

    try {
      await session.say(greetingText);
    } catch (e) {
      console.error("[Voice Agent] Failed to say initial greeting:", e);
    }
  },
});
