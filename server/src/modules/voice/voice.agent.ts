import { defineAgent, llm, voice } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import * as google from "@livekit/agents-plugin-google";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import axios from "axios";
import mongoose from "mongoose";
import { ChatSession } from "../agent/models/chatSession.model";
import { z } from "zod";
import { env } from "../../config/env.config";
import connectDB from "../../config/db.config";

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
      instructions: `You are Shriya, a friendly and professional real estate voice advisor.
Your goal is to assist users with their property-related questions and help them find suitable homes through natural conversation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE #1 — LANGUAGE (NON-NEGOTIABLE, ZERO EXCEPTIONS):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Look at the LAST thing the user said (the message you are replying to right now).
Whatever language they spoke in — YOU MUST REPLY IN THAT EXACT SAME LANGUAGE.

Examples of correct behavior:
- User speaks in Hindi → your entire reply is in Hindi.
- User speaks in English → your entire reply is in English.
- User speaks in Marathi → your entire reply is in Marathi.
- User switches from Hindi to English → you immediately switch to English. Forget you were speaking Hindi.
- User switches from English back to Hindi → you immediately switch to Hindi.

WRONG behavior (never do this):
- User speaks in English, you reply in Hindi. ← FORBIDDEN.
- User speaks in Marathi, you reply in Hindi. ← FORBIDDEN.
- You continue in a language the user used two messages ago. ← FORBIDDEN.

The only words that may stay in English regardless of language: property names, locality names, city names, and real estate abbreviations (BHK, EMI, RERA). All conversational words must match the user's current language.
For voice: keep each sentence short — 12 words or fewer — so it sounds natural when spoken aloud.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

KNOWLEDGE & PROACTIVITY:
1. USE YOUR KNOWLEDGE: You have extensive knowledge about real estate, home-buying processes, financial terms (EMI, down payments), and various localities. Use this knowledge to provide helpful, detailed answers.
2. BE PROACTIVE: If a user asks about a locality, don't just wait for filters—tell them what makes that locality special (amenities, connectivity, lifestyle) based on your knowledge.
3. NEVER REFUSE: Do NOT say "I don't have a tool for that" or "I am only a real estate advisor." If a question is even remotely related to real estate, lifestyle, or moving, provide a helpful answer using your internal knowledge.
4. If a user asks something completely unrelated, briefly answer and then politely steer the conversation back to how you can help them find a home.

INVENTORY-FIRST SEARCH STRATEGY (CRITICAL — follow this order every time):
1. The moment a user mentions a city or region of interest, IMMEDIATELY call property_search with ONLY that city as a filter, maxResults: 3, AND set isInventoryProbe: true. This is a silent inventory probe — it runs in the background only and returns ONLY a count.
2. If the probe returns results (count > 0): Do NOT show any property cards yet. Do NOT call display_recommended_properties. Simply tell the user you have options available in that city and ask ONE follow-up question — either BHK size OR budget, whichever feels most natural.
3. If the probe returns 0 results: STOP immediately. Do NOT ask for BHK, budget, or any other requirement. Call get_available_cities to get the real list of cities where we have inventory, then tell the user which cities ARE available. Never guess or make up city names.
4. Only call display_recommended_properties AFTER you have gathered at least the user's BHK preference OR budget. Then run a refined search with those filters and show the results.
5. REUSE CONTEXT BEFORE RE-SEARCHING: If the user relaxes a constraint (e.g., "forget the budget, show me any 2 BHK" or "ignore BHK, show me anything"), first check whether your earlier search results from this conversation already contain matching properties. If yes, display those without a new search. Only run a new property_search if the earlier results genuinely do not cover the relaxed request.
6. Never say "we don't have listings" for a city that your earlier probe already confirmed has inventory. That confirmation stays valid for the whole conversation.

CONVERSATIONAL GUIDELINES:
1. Be human-like, warm, and conversational.
2. HANDLING GREETINGS: Greet users warmly. For example: "Hello! How can I help you today?".
   - CRITICAL: Do NOT ask for preferences in your first response to a greeting. Wait for them to express interest.
3. PREFERENCE GATHERING: Gather requirements only after confirming inventory exists for the requested location (see INVENTORY-FIRST above).
4. ONE AT A TIME: Ask only ONE question at a time to keep it natural.
5. Be polite, warm, and concise.
6. PLAIN TEXT ONLY: DO NOT use markdown formatting like bold (**text**) or lists. Use plain spoken text only.

CRITICAL INSTRUCTIONS:
1. SEARCH & DISPLAY: Use display_recommended_properties ONLY after a non-probe search (one that returns full property details). Never after an inventory probe. Write a personalized ai_pitch per property.
2. NO TEXT-ONLY LISTINGS: DO NOT describe a specific property's details in your spoken text without invoking the display_recommended_properties tool. If you are recommending a specific property, you MUST show it on the UI using the tool.
3. FOLLOW-UPS: Use conversation history to answer questions about specific properties clearly.`,
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
    if (mongoose.connection.readyState === 0) {
      await connectDB();
    }
    
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
    let chatHistoryStr = "";

    const session = new voice.AgentSession({
      vad,
      stt: new deepgram.STT({ 
        model: "nova-3", 
        language: "multi",
        apiKey: env.DEEPGRAM_API_KEY || process.env.DEEPGRAM_API_KEY
      }),
      llm: new google.LLM({ 
        model: "gemini-2.5-flash",
        apiKey: env.GEMINI_API_KEY || process.env.GEMINI_API_KEY,
        temperature: 0.4
      }),
      tts: new elevenlabs.TTS({
        model: "eleven_flash_v2_5",
        apiKey: env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY,
        ...(env.ELEVENLABS_VOICE_ID && { voiceId: env.ELEVENLABS_VOICE_ID }),
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
    });

    await session.start({
      room: ctx.room,
      agent,
    });

    await ctx.connect();

    // Load recent chat history only after the room is connected, because the
    // room context may be unavailable during worker startup.
    try {
      const metadataStr = ctx.room?.metadata || "{}";
      console.debug('[Voice] ctx.room.name:', ctx.room?.name, 'ctx.room.metadataRaw:', metadataStr);

      const metadata = JSON.parse(metadataStr);

      // Prefer explicit metadata.sessionId, but fall back to parsing the LiveKit room name
      // which we set to `voice-${sessionId}` in the token endpoint.
      let resolvedSessionId: string | undefined = metadata.sessionId;
      if (!resolvedSessionId && ctx.room?.name && typeof ctx.room.name === 'string') {
        const match = String(ctx.room.name).match(/^voice-(.+)$/);
        if (match) resolvedSessionId = match[1];
      }

      if (resolvedSessionId) {
        const session = await ChatSession.findOne({ sessionId: resolvedSessionId }).lean().exec();
        const historyMessages = (session?.messages ?? [])
          .filter((message) => message.type === "text" && typeof message.content === "string" && message.content.trim().length > 0)
          .slice(-10);

        if (historyMessages.length > 0) {
          chatHistoryStr = historyMessages
            .map((message) => `${message.sender === "user" ? "User" : "Agent"}: ${message.content}`)
            .join("\n");
        }

        console.debug("[Voice] Resolved sessionId for history:", resolvedSessionId, "loadedMessages:", historyMessages.length);
      } else {
        console.debug('[Voice] No sessionId found in room metadata or room name; skipping history load.');
      }
    } catch (e) {
      console.error("[Voice] Failed to load chat history for context", e);
    }

    const isResumeSession = chatHistoryStr.trim().length > 0;

    // When resuming from history we must be strict: do NOT introduce the agent
    // or state the agent's name. Produce a single, short acknowledgement
    // (<= 8 words) and then stop. This prevents the long greeting from being
    // spoken again when continuing a paused session.
    await session.generateReply({
      instructions: isResumeSession
        ? "Do NOT introduce yourself or state your name. Produce a single brief acknowledgement (no more than 8 words) such as 'I'm here — shall we continue?' and then stop. Do not ask additional questions or re-introduce previous context aloud."
        : "Greet the user naturally, introduce yourself as Shriya (their property advisor), and ask how you can help them today.",
    });
  },
});
