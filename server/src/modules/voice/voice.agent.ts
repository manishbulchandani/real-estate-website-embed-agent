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
}

export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  Hinglish: {
    name: "Hindi mixed with natural English words (Hinglish)",
    greeting: "नमस्ते! मैं Shriya हूँ, आपकी virtual real estate assistant. मैं आपकी कैसे मदद कर सकती हूँ?",
    systemInstruction: `You MUST respond in natural conversational Hindi mixed with English words (written in Devanagari script for Hindi words, e.g. 'नमस्ते', 'मैं', 'हूँ', and English script for English words like 'options', 'available', 'property'). Never write Hindi words in the Roman alphabet.
Example of a GOOD spoken response: "Navi Mumbai में हमारे पास कुछ options available हैं। आप कितने BHK की property देख रहे हैं?"`
  },
  English: {
    name: "English",
    greeting: "Hello! I am Shriya, your virtual real estate assistant. How can I help you today?",
    systemInstruction: `You MUST respond entirely in natural, conversational English. Under no circumstances should you output any Hindi or Marathi words.`
  },
  Marathi: {
    name: "Marathi mixed with natural English words",
    greeting: "नमस्कार! मी Shriya आहे, तुमची virtual real estate assistant. मी तुम्हाला कशी मदत करू शकते?",
    systemInstruction: `You MUST respond in natural conversational Marathi mixed with English words (written in Devanagari script for Marathi words, e.g. 'नमस्कार', 'मी', 'आहे', and English script for English words like 'options', 'available', 'property'). Never write Marathi words in the Roman alphabet.
Example of a GOOD spoken response: "Navi Mumbai मध्ये आमच्याकडे काही options available आहेत। आपण किती BHK ची property पाहत आहात?"`
  }
};

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
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx) => {
    if (mongoose.connection.readyState === 0) {
      await connectDB();
    }

    let resolvedSessionId: string | undefined;
    const recommendedById = new Map<string, PropertyRecord>();
    const encoder = new TextEncoder();

    // Property search tool - queries backend recommendations endpoint
    const propertySearchTool = llm.tool({
      description:
        "Search for properties using natural language query and/or structured filters (city, locality, BHK, budget range).",
      parameters: z.object({
        query: z.string().optional().describe("Free-form text query, e.g. '3 BHK near metro' or 'luxurious villa'"),
        filters: z
          .object({
            bhk: z.union([z.number(), z.array(z.number())]).optional().describe("Number of bedrooms, e.g. 2, 3"),
            budgetMin: z.number().optional().describe("Minimum budget in INR"),
            budgetMax: z.number().optional().describe("Maximum budget in INR"),
            locality: z.string().optional().describe("Specific locality or area"),
            city: z.string().optional().describe("City name"),
            listing_type: z.union([z.string(), z.array(z.string())]).optional().describe("'Buy' or 'Rent'"),
            suitability: z.array(z.string()).optional().describe("E.g. 'Family', 'Bachelors', 'Investment'"),
          })
          .optional().describe("Structured filters to refine the search"),
        maxResults: z.number().min(1).max(20).optional().describe("Maximum number of results to return (default 10)"),
        excludeIds: z.array(z.string()).optional().describe("List of Property IDs to exclude from search results"),
        isInventoryProbe: z.boolean().optional().describe("CRITICAL: Set to true if this is a silent inventory probe (e.g. checking city availability before asking for BHK/budget). When true, returns ONLY a count, physically preventing property cards from displaying prematurely."),
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

          if (args.isInventoryProbe) {
            const uniqueBhks = Array.from(new Set(properties.map(r => r.bhk).filter(b => typeof b === 'number' && b > 0))).sort((a, b) => a - b);
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
        "Display selected property recommendations on screen. Call this after property_search. CRITICAL: The ai_pitch field for every property must be written in the Roman/English alphabet only (transliterated Hinglish style). NEVER use Devanagari characters in ai_pitch.",
      parameters: z.object({
        properties: z.array(
          z.object({
            id: z.string(),
            ai_pitch: z.string().describe("A compelling 1-2 sentence pitch. MUST BE WRITTEN IN HINGLISH (Hindi words written using the English alphabet). CRITICAL: DO NOT use Devanagari characters, and DO NOT translate to pure English. Example: 'Yeh 1.5 BHK apartment Airoli mein hai aur aapke liye perfect hai.'"),
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

    // Booking visit tool
    const bookVisitTool = llm.tool({
      description: `Book a site visit or schedule a developer call for a specific property.
      
Before calling this tool, you MUST gather:
1. The property name and property ID of interest.
2. The user's preferred date (e.g., 'next Friday', '2026-06-25').
3. The preferred time slot (e.g., '11:00 AM', 'Morning', 'Evening').
4. The user's name.
5. The user's phone number.

Do NOT guess or invoke this tool if any of these five details are missing. Ask the user for the missing details first.`,
      parameters: z.object({
        propertyId: z.string().describe("The ID of the property to book a visit for"),
        propertyName: z.string().describe("The name of the property"),
        date: z.string().describe("The preferred date of the visit"),
        timeSlot: z.string().describe("The preferred time slot/time of day"),
        userName: z.string().describe("The user's name"),
        userPhone: z.string().describe("The user's phone number")
      }),
      execute: async (args) => {
        const bookingId = "BK-" + Math.floor(1000 + Math.random() * 9000);
        const booking = {
          ...args,
          bookingId,
          status: "Confirmed" as const
        };

        if (ctx.room) {
          try {
            await ctx.room.localParticipant?.publishData(
              encoder.encode(
                JSON.stringify({
                  type: "voice_booking",
                  booking: booking
                })
              ),
              {
                reliable: true,
                topic: "property_recommendations"
              }
            );
          } catch (e) {
            console.error("Failed to publish booking data:", e);
          }
        }

        // Persist booking to ChatSession database
        if (resolvedSessionId) {
          try {
            await ChatSession.findOneAndUpdate(
              { sessionId: resolvedSessionId },
              {
                $setOnInsert: { sessionId: resolvedSessionId },
                $push: {
                  messages: {
                    id: crypto.randomUUID(),
                    sender: "agent",
                    type: "booking",
                    data: booking,
                  },
                },
              },
              { upsert: true }
            ).exec();
            console.log(`[Voice] Persisted booking ${bookingId} to ChatSession:`, resolvedSessionId);
          } catch (dbErr) {
            console.error("[Voice] Failed to save booking to ChatSession:", dbErr);
          }
        }

        return booking;
      }
    });

    // Manage preference tool
    const managePreferenceToolTool = llm.tool({
      description: "Add or remove a property from the user's shortlist/wishlist, or mark it as not interested. Call this when the user explicitly asks to shortlist/wishlist a property, or when they say they don't like a property. You can also proactively offer to shortlist properties they seem very interested in.",
      parameters: z.object({
        propertyId: z.string().describe("The ID of the property"),
        action: z.enum(["shortlist", "remove_shortlist", "not_interested", "remove_not_interested"]).describe("The action to perform"),
      }),
      execute: async (args) => {
        if (!resolvedSessionId) {
          return { error: "Cannot manage preference because sessionId is missing." };
        }

        try {
          const session = await ChatSession.findOneAndUpdate(
            { sessionId: resolvedSessionId },
            { $setOnInsert: { sessionId: resolvedSessionId } },
            { upsert: true, new: true }
          );

          let updatedShortlist = new Set(session.shortlistedProperties || []);
          let updatedNotInterested = new Set(session.notInterestedProperties || []);

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

          // Publish data to frontend
          if (ctx.room) {
            await ctx.room.localParticipant?.publishData(
              encoder.encode(
                JSON.stringify({
                  type: "voice_preference_update",
                  preferences: {
                    shortlistedProperties: session.shortlistedProperties,
                    notInterestedProperties: session.notInterestedProperties
                  }
                })
              ),
              { reliable: true, topic: "property_preferences" }
            );
          }

          return { success: true, action: args.action, propertyId: args.propertyId };
        } catch (e) {
          console.error("Failed to manage property preference:", e);
          return { error: "Failed to manage property preference due to an internal error." };
        }
      }
    });

    const roomName = ctx.job.room?.name || ctx.room?.name;
    let language = "Hinglish"; // default
    if (roomName && typeof roomName === 'string') {
      const match = String(roomName).match(/^voice-(Hinglish|English|Marathi|.+?)-(.+)$/);
      if (match) {
        language = match[1];
        resolvedSessionId = match[2];
      } else {
        const fallbackMatch = String(roomName).match(/^voice-(.+)$/);
        if (fallbackMatch) resolvedSessionId = fallbackMatch[1];
      }
    }

    console.log(`[Voice Agent] entry triggered. raw roomName: "${roomName}" (from job: "${ctx.job.room?.name}", from room: "${ctx.room?.name}")`);
    console.log(`[Voice Agent] Resolved connection language: "${language}", sessionId: "${resolvedSessionId}"`);

    const langConfig = LANGUAGE_CONFIGS[language] || LANGUAGE_CONFIGS.Hinglish;

    const instructions = `You are Shriya, a friendly and professional real estate voice advisor.
Your goal is to assist users with their property-related questions and help them find suitable homes through natural conversation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE #1 — LANGUAGE STYLE (NON-NEGOTIABLE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Selected language/style: ${langConfig.name}.
- ${langConfig.systemInstruction}
- The only words that may stay in English regardless of language: property names, locality names, city names, and real estate abbreviations (BHK, EMI, RERA).
- For voice: keep each sentence short — 12 words or fewer — so it sounds natural when spoken aloud.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

KNOWLEDGE & PROACTIVITY:
1. USE YOUR KNOWLEDGE: You have extensive knowledge about real estate, home-buying processes, financial terms (EMI, down payments), and various localities. Use this knowledge to provide helpful, detailed answers.
2. BE PROACTIVE: If a user asks about a locality, don't just wait for filters—tell them what makes that locality special (amenities, connectivity, lifestyle) based on your knowledge.
3. NEVER REFUSE: Do NOT say "I don't have a tool for that" or "I am only a real estate advisor." If a question is even remotely related to real estate, lifestyle, or moving, provide a helpful answer using your internal knowledge.
4. If a user asks something completely unrelated, briefly answer and then politely steer the conversation back to how you can help them find a home.
5. DEMO MODE & DUMMY ANSWERS: For demo purposes, if the user asks for specific details or information about a property (e.g. amenities, possession date, exact distance to landmarks, specific layout features, or RERA status) and that information is not available in the database, DO NOT say "I don't know" or refuse to answer. Instead, act as a knowledgeable sales agent of that property and generate a realistic, professional-sounding dummy answer on the fly using your internal intelligence. Present it confidently and naturally.
6. VISIT BOOKING & PROACTIVE CLOSING:
   - STRATEGIC GOAL: Your ultimate motive is to try to get the sale closed. You must be proactive but strategic. Do NOT suggest booking a site visit on the very first message or on every property search result.
   - WHEN TO PROPOSE: Suggest booking a site visit or scheduling a developer call when the user shows strong interest in a specific property (e.g., asking detailed questions about layout/amenities/RERA, comparing specific properties, or expressing positive sentiment/approval). Warmly propose: "Would you like to schedule a site visit to experience the project firsthand? Or perhaps we can schedule a quick call with the developer's representative?"
   - GATHERING INFO: Before calling the 'book_visit' tool, you MUST gather: property name, preferred date (e.g., next Friday, June 20th), preferred time slot (e.g., 11:00 AM, Morning, Evening), user's name, and user's phone number.
   - ONE AT A TIME: Ask for these missing details naturally, one at a time, to keep the conversation warm and conversational.
   - FINALIZING: Once all five pieces of information are gathered, call 'book_visit' to confirm. Tell the user it is booked and summarize the details.
7. SHORTLISTING & PREFERENCES:
   - If a user expresses strong interest in a property, proactively ask: "Would you like me to add this to your shortlist?"
   - Use 'manage_preference' to shortlist properties or mark them as not interested based on user feedback.

INVENTORY-FIRST SEARCH STRATEGY (CRITICAL — follow this order every time):
1. The moment a user mentions a city or region of interest, IMMEDIATELY call property_search with ONLY that city as a filter, maxResults: 3, AND set isInventoryProbe: true. This is a silent inventory probe — it runs in the background only and returns ONLY a count.
2. If the probe returns results (count > 0): Do NOT show any property cards yet. Do NOT call display_recommended_properties. Simply tell the user you have options available in that city and ask ONE follow-up question — either BHK size OR budget, whichever feels most natural.
3. If the probe returns 0 results: STOP immediately. Do NOT ask for BHK, budget, or any other requirement. Call get_available_cities to get the real list of cities where we have inventory, then tell the user which cities ARE available. Never guess or make up city names.
4. Only call display_recommended_properties AFTER you have gathered at least the user's BHK preference OR budget. Then run a refined search with those filters and show the results.
5. REUSE CONTEXT BEFORE RE-SEARCHING: If the user relaxes a constraint (e.g., "forget the budget, show me any 2 BHK" or "ignore BHK, show me anything"), first check whether your earlier search results from this conversation already contain matching properties. If yes, display those without a new search. Only run a new property_search if the earlier results genuinely do not cover the relaxed request.
6. Never say "we don't have listings" for a city that your earlier probe already confirmed has inventory. That confirmation stays valid for the whole conversation.

CONVERSATIONAL GUIDELINES:
1. Be human-like, warm, and conversational.
2. HANDLING GREETINGS: Greet users warmly in the selected language. Your default first greeting message MUST be exactly: "${langConfig.greeting}".
   - CRITICAL: Do NOT ask for preferences in your first response to a greeting. Wait for them to express interest.
3. PREFERENCE GATHERING: Gather requirements only after confirming inventory exists for the requested location (see INVENTORY-FIRST above).
4. ONE AT A TIME: Ask only ONE question at a time to keep it natural.
5. Be polite, warm, and concise.
6. PLAIN TEXT & NO EMOJIS (CRITICAL):
   - DO NOT use emojis (e.g. 🏠, ✨).
   - DO NOT use markdown formatting like bold (**text**) or lists.
   - DO NOT use special characters like asterisks (*), hashtags (#), or exclamation marks (!).
   - Use strictly plain spoken text with ONLY basic punctuation (periods, commas, question marks).
   - DO NOT output any internal monologue, reasoning, planning, notes, or chain-of-thought (e.g., do NOT write "The user mentioned...", "I need to..."). Start your response directly with the words you want to say to the user.
7. MODERN LANGUAGE & SCRIPT (CRITICAL):
   - For your main spoken response: You MUST mix English words (written in the English alphabet) and words of the target language (written in Devanagari script for Hinglish/Marathi) naturally, just like modern urban Indians speak.
   - CRITICAL PENALTY FOR UI CARDS: The 'ai_pitch' inside 'display_recommended_properties' MUST ONLY use English letters A-Z (Roman script). If you output Hindi/Devanagari characters (e.g., 'यह') in 'ai_pitch', the system will crash. Write it as 'Yeh property Chembur mein hai'.

CRITICAL INSTRUCTIONS:
1. SEARCH & DISPLAY: Use display_recommended_properties ONLY after a non-probe search (one that returns full property details). Never after an inventory probe. Write a personalized ai_pitch per property.
2. NO TEXT-ONLY LISTINGS: DO NOT describe a specific property's details in your spoken text without invoking the display_recommended_properties tool. If you are recommending a specific property, you MUST show it on the UI using the tool.
3. FOLLOW-UPS: Use conversation history to answer questions about specific properties clearly.`;

    const agent = new RealEstateVoiceAgent(instructions, {
      property_search: propertySearchTool,
      display_recommended_properties: displayPropertiesToolTool,
      book_visit: bookVisitTool,
      manage_preference: managePreferenceToolTool,
    });

    const STT_LANGUAGES: Record<string, string> = {
      Hinglish: "hi",
      English: "en",
      Marathi: "mr",
    };

    const vad = ctx.proc.userData.vad as silero.VAD;
    let chatHistoryStr = "";

    const session = new voice.AgentSession({
      vad,
      stt: new deepgram.STT({
        model: "nova-2-conversationalai",
        language: STT_LANGUAGES[language] || "hi",
        interimResults: true,
        smartFormat: true,
        apiKey: env.DEEPGRAM_API_KEY || process.env.DEEPGRAM_API_KEY
      }),
      llm: new openai.LLM({
        model: env.OPENROUTER_VOICE_MODEL,
        apiKey: env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
        temperature: 0.4
      }),
      tts: new elevenlabs.TTS({
        model: "eleven_flash_v2_5",
        apiKey: env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY,
        ...(env.ELEVENLABS_VOICE_ID && { voiceId: env.ELEVENLABS_VOICE_ID }),
        language: STT_LANGUAGES[language] || "hi",
      }),
      turnHandling: {
        turnDetection: "vad",
        interruption: {
          mode: "vad",
          minDuration: 300,
          minWords: 0,
        },
        endpointing: {
          mode: "fixed",
          minDelay: 500,
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

      if (!resolvedSessionId) {
        resolvedSessionId = metadata.sessionId;
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
        : `Greet the user naturally in the selected language style, introducing yourself as Shriya. GREETING MANDATE: You MUST output exactly this greeting phrase: "${langConfig.greeting}". Speak only this greeting and stop.`,
    });
  },
});
