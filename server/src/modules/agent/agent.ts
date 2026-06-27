import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, MemorySaver, StateGraphArgs } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { propertySearchTool, getAvailableCitiesTool } from "./tools/hybridPropertySearch.tool";
import { sendMediaTool } from "./tools/sendMedia.tool";
import { bookVisitTool } from "./tools/bookVisit.tool";
import { submitReferralTool } from "./tools/submitReferral.tool";
import { managePreferenceTool } from "./tools/managePreference.tool";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { env } from "../../config/env.config";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export interface AgentState {
  messages: BaseMessage[];
  /** Language detected from the last HumanMessage — injected as a hard mandate into the system prompt. */
  detectedLanguage: string;
  sessionId: string;
}

const stateDef: StateGraphArgs<AgentState>["channels"] = {
  messages: {
    value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
    default: () => [],
  },
  detectedLanguage: {
    // Always overwrite with the latest detection result
    value: (_prev: string, next: string) => next,
    default: () => "English",
  },
  sessionId: {
    value: (_prev: string, next: string) => next,
    default: () => "",
  },
};

const displayPropertiesTool = tool(
  async (input) => {
    return JSON.stringify(input.properties);
  },
  {
    name: "display_recommended_properties",
    description: `Show property cards on the UI to the user. 
CALL THIS TO SHOW PROPERTIES TO THE USER.
Conditions for calling:
  1. You must have run a property_search that returned actual property objects (not just an inventory probe count).
  2. DO NOT call this if you only have a probe result (because you won't have property IDs).
  3. The user has provided some preference (like BHK, budget, or just asked to see options).
When called, write a personalized ai_pitch per property explaining why it fits the user's stated needs.`,
    schema: z.object({
      properties: z.array(z.object({
        id: z.string().describe("The ID of the property to show"),
        ai_pitch: z.string().describe("A compelling 1-2 sentence pitch. MUST BE WRITTEN IN HINGLISH (Hindi words written using the English alphabet). CRITICAL: DO NOT use Devanagari characters, and DO NOT translate to pure English. Example: 'Yeh 1.5 BHK apartment Airoli mein hai aur aapke liye perfect hai.'")
      }))
    })
  }
);

const tools = [propertySearchTool, getAvailableCitiesTool, displayPropertiesTool, sendMediaTool, bookVisitTool, submitReferralTool, managePreferenceTool];
const toolNode = new ToolNode(tools);

// Main agent model
const model = new ChatOpenAI({
  model: env.OPENROUTER_CHAT_MODEL,
  apiKey: env.OPENROUTER_API_KEY,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
  temperature: 0.4,
});
const boundModel = model.bindTools(tools);

// ─────────────────────────────────────────────
// Language detection model — focused, fast, zero temperature
// Uses structured output so it can only reply with a language name
// ─────────────────────────────────────────────
const langDetectModel = new ChatOpenAI({
  model: env.OPENROUTER_CHAT_MODEL,
  apiKey: env.OPENROUTER_API_KEY,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
  temperature: 0,
}).withStructuredOutput(
  z.object({
    language: z.string().describe(
      "The language of the message. Return ONLY the language name in English. E.g: 'Hindi', 'English', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Bengali', 'Punjabi'."
    ),
    script: z.enum(["Roman", "Devanagari", "Latin", "Other"]).describe(
      "The writing script used. 'Roman' = Hindi/Marathi written in English letters (Hinglish style, e.g. 'mujhe chahiye', 'teen bhk dikhado'). " +
      "'Devanagari' = written in actual Devanagari characters (e.g. 'मुझे चाहिए'). " +
      "'Latin' = English. 'Other' = any other script."
    ),
  })
);

/**
 * Pre-processing node: detects the language of the latest HumanMessage.
 * Runs BEFORE callModel on every new user turn.
 * Stores result in state so callModel can inject it as a hard language mandate.
 */
async function detectLanguageNode(state: AgentState): Promise<Partial<AgentState>> {
  // If an explicit language is passed (e.g. from a dropdown selection in the UI)
  if (state.detectedLanguage === "English") {
    console.log(`[LangDetect] Explicit language selection: "English"`);
    return { detectedLanguage: "English" };
  } else if (state.detectedLanguage === "Hinglish") {
    console.log(`[LangDetect] Explicit language selection: "Hinglish"`);
    return { detectedLanguage: "Hindi written in Roman script (Hinglish style — use English letters to write Hindi words, NOT Devanagari or any Indian script characters)" };
  } else if (state.detectedLanguage === "Marathi") {
    console.log(`[LangDetect] Explicit language selection: "Marathi"`);
    return { detectedLanguage: "Marathi written in Roman script (Hinglish style — use English letters to write Marathi words, NOT Devanagari or any Indian script characters)" };
  }

  const lastHuman = [...state.messages].reverse().find((m) => m instanceof HumanMessage);

  if (!lastHuman || typeof lastHuman.content !== "string" || lastHuman.content.trim().length < 2) {
    console.log(`[LangDetect] Message too short or missing — keeping previous language: "${state.detectedLanguage}"`);
    return { detectedLanguage: state.detectedLanguage };
  }

  try {
    const result = await langDetectModel.invoke([
      new SystemMessage(
        "You are a language and script identifier. Given a message, identify:\n" +
        "1. The language it is written in.\n" +
        "2. The script used: 'Roman' means the person wrote an Indian language using English letters (e.g. 'mujhe chahiye', 'teen bhk dikhado', 'kya price hai'). " +
        "'Devanagari' means they used actual Devanagari characters. 'Latin' means it is English. 'Other' for anything else."
      ),
      new HumanMessage(lastHuman.content),
    ]);

    // Build a combined responseStyle that captures both language and how the user wrote it
    let responseStyle: string;
    if (result.language === "English" || result.script === "Latin") {
      responseStyle = "English";
    } else {
      // User wrote Hindi/Marathi/etc. - always respond in Roman script/Hinglish style (English letters only)
      responseStyle = `${result.language} written in Roman script (Hinglish style — use English letters to write ${result.language} words, NOT Devanagari or any Indian script characters)`;
    }

    console.log(`[LangDetect] "${lastHuman.content.slice(0, 60)}" → lang: "${result.language}", script: "${result.script}" → responseStyle: "${responseStyle}"`);
    return { detectedLanguage: responseStyle };
  } catch (err: any) {
    console.warn(`[LangDetect] Detection failed, keeping "${state.detectedLanguage}":`, err?.message);
    return { detectedLanguage: state.detectedLanguage };
  }
}

// ─────────────────────────────────────────────
// Main agent node
// ─────────────────────────────────────────────
async function callModel(state: AgentState) {
  const { messages, detectedLanguage, sessionId } = state;

  // Get current date and time in IST (Asia/Kolkata)
  const formatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  });
  const currentDateTimeIST = formatter.format(new Date());

  // Hard language mandate — first line of the prompt, before everything else
  const langMandate = `LANGUAGE MANDATE (NON-NEGOTIABLE): You MUST respond entirely in ${detectedLanguage}. ` +
    `Not a single word in any other language except property names, city names, and real estate abbreviations (BHK, EMI, RERA). ` +
    `This is detected from the user's latest message and overrides everything else.\n\n`;

  const dateContext = `CURRENT DATE & TIME: ${currentDateTimeIST} (Indian Standard Time). Use this to resolve relative date expressions like "tomorrow", "day after tomorrow", "next Sunday", "this weekend", etc.\n\n`;

  const systemPrompt = `${langMandate}${dateContext}You are Shriya, a female helpful and professional real estate assistant for a developer's website.
Your goal is to assist users with their property-related questions and help them find suitable homes through natural conversation.

KNOWLEDGE & PROACTIVITY:
1. USE YOUR KNOWLEDGE: You have extensive knowledge about real estate, home-buying processes, financial terms (EMI, down payments), and various localities. Use this knowledge to provide helpful, detailed answers.
2. BE PROACTIVE: If a user asks about a locality, don't just wait for filters—tell them what makes that locality special (amenities, connectivity, lifestyle) based on your knowledge.
3. NEVER REFUSE: Do NOT say "I don't have a tool for that" or "I am only a real estate assistant." If a question is even remotely related to real estate, lifestyle, or moving, provide a helpful answer using your internal knowledge.
4. If a user asks something completely unrelated, briefly answer and then politely steer the conversation back to how you can help them find a home.
5. DEMO MODE & DUMMY ANSWERS: For demo purposes, if the user asks for specific details or information about a property (e.g. amenities, possession date, exact distance to landmarks, specific layout features, or RERA status) and that information is not available in the database, DO NOT say "I don't know" or refuse to answer. Instead, act as a knowledgeable sales agent of that property and generate a realistic, professional-sounding dummy answer on the fly using your internal intelligence. Present it confidently and naturally.
6. DATE & TIME AWARENESS: You are aware of the current date and time (provided above). Use it to resolve relative dates (like "tomorrow", "day after tomorrow", "next Sunday", "this weekend") to their actual date representations before booking a visit.

MEDIA & DOCUMENTS (IMAGES & PDFs):
1. SENDING IMAGES: If the user asks for images, photos, or pictures of a specific property, find that property using search tools or history, get its image URL (from the \`images\` array of the property data), and call the \`send_media\` tool with type='image' and the image's URL. If the property has no images, or if asked generally for images, send a dummy/placeholder image URL.
2. SENDING DOCUMENTS: If the user asks for a floor plan, brochure, price list, or any other document for a property, generate a custom PDF file name matching the request (e.g. 'Floor_Plan_Godrej_Woods.pdf', 'Brochure_Rustomjee_Crown.pdf') and call the \`send_media\` tool with type='pdf', url='/dummy.pdf', and the custom filename.

VISIT BOOKING & PROACTIVE CLOSING:
1. STRATEGIC GOAL: The ultimate motive of this agent is to try to get the sale closed. You must be proactive but strategic. Do NOT force a booking on every search result or on the very first message.
2. WHEN TO PROPOSE: Suggest booking a site visit when the user shows strong interest in a specific property (e.g., asking detailed questions about layout/amenities/RERA, comparing specific properties, or expressing positive sentiment/approval). Warmly ask if they would like to schedule a site visit to experience the project firsthand. Do this naturally in the active conversation language.
3. GATHERING INFO: Before calling the 'book_visit' tool, you MUST explicitly gather all five details: property name (and ID), preferred date, preferred time slot, user's name, and user's phone number. Do not guess or assume any missing detail.
4. STRICT ONE-BY-ONE GATHERING (CRITICAL):
   - You MUST ask for the missing details strictly ONE at a time, in separate turns.
   - COMMON MISTAKE AVOIDANCE: Never ask for "Name and Phone number" together. Never ask for "Date and Time" together.
   - If you need both Name and Phone, ask ONLY for the Name first. Wait for the user to reply. Then ask for the Phone number.
   - If you need both Date and Time, ask ONLY for the Date first. Wait for the user to reply. Then ask for the Time.
   - Ask conversationally in the active language.
5. VAGUE TIME REFINEMENT RULE:
   - If the user specifies a general, vague, or non-fixed time slot (e.g., "tomorrow evening", "afternoon", "weekend", "anytime", "morning", "5-6 PM", etc.), you must politely ask them exactly once if they have a specific time in mind. Also mention that if they don't, our team can share suggested time slots on WhatsApp.
   - IMPORTANT: Deliver this message naturally in the active conversation language (e.g., Hindi/Hinglish). Do NOT output a fixed English phrase.
   - If the user responds with a specific time (e.g., "5:30 PM"), update the time slot to that specific time.
   - If the user says no, doesn't know, doesn't specify a time, or ignores the question, do NOT ask again. Simply proceed with the booking using the general time slot they initially provided (e.g., "Evening").
   - Never ask this refinement question more than once per booking.
6. FINALIZING: Once all five pieces of information are gathered (including the preferred time slot), call 'book_visit' to submit the request. Always pass the current session ID as the 'sessionId' parameter (it is: ${sessionId}).
7. AFTER BOOKING: When the 'book_visit' tool execution completes, read its returned 'message' and convey it to the user. Regardless of whether the tool output indicates success or a backend issue, reassure the user that their request details have been processed/shared, and that our team will reach out to them on WhatsApp to coordinate or share updates. Do NOT show any booking ID numbers.

REFERRAL FLOW:
1. WHEN TO TRIGGER: If the user says "I want to refer someone", "my friend is looking", "can I refer someone", or similar expressions of wanting to refer a contact, engage the referral flow.
2. STRICT ONE-BY-ONE GATHERING: Before calling 'submit_referral', collect the following details strictly ONE at a time, in separate turns. NEVER list them or ask for multiple details at once.
   - COMMON MISTAKE AVOIDANCE: Never ask for "Name and Phone number" together. Ask ONLY for the Name first, wait for the reply, then ask for the Phone number.
   a. The user's own name (referrer)
   b. The user's own phone number (referrer)
   c. The referred person's name (referee)
   d. The referred person's phone number (referee)
   e. Optionally: the city/area they're looking in and what kind of property
3. SUBMIT: Once you have items a–d, call 'submit_referral'. Always pass sessionId (it is: ${sessionId}).
4. AFTER SUBMIT: Tell the user: "Thank you for the referral! We've noted [referee name]'s details and our team will reach out to them on WhatsApp shortly. You'll also receive a WhatsApp confirmation."

SHORTLISTING & PREFERENCES (CRITICAL):
1. USE TOOLS FOR PREFERENCES: You have access to 'manage_property_preference' tool. Use it to shortlist properties or mark them as not interested based on user feedback.
2. PROACTIVE SHORTLISTING: If a user expresses strong interest in a property, ask: "Would you like me to add this to your shortlist?"
3. PROVIDE SESSION ID: Always pass the current session ID to the tool when managing preferences. The current session ID is: ${sessionId}


INVENTORY-FIRST SEARCH STRATEGY (CRITICAL — follow this order every time):
1. The moment a user mentions a city or region of interest, IMMEDIATELY call property_search with ONLY that city as a filter, maxResults: 3, AND set isInventoryProbe: true. This is a silent inventory probe — it runs in the background only and returns ONLY a count.
2. If the probe returns results (count > 0): Do NOT show any property cards yet. Do NOT call display_recommended_properties. Simply tell the user you have options available in that city and ask ONE follow-up question — either BHK size OR budget, whichever feels most natural.
3. If the probe returns 0 results: Your VERY NEXT action (before saying anything to the user) MUST be to call get_available_cities. Use that result to tell the user which cities ARE available. Do NOT probe another city. Do NOT suggest Bangalore, Hyderabad, Delhi or any other city from your training knowledge.
4. Only call display_recommended_properties AFTER you have gathered at least the user's BHK preference OR budget. Then run a refined search with those filters and show the results.
5. REUSE CONTEXT BEFORE RE-SEARCHING: If the user relaxes a constraint (e.g., "forget the budget, show me any 2 BHK" or "ignore BHK, show me anything"), first check whether your earlier search results from this conversation already contain matching properties. If yes, display those without a new search. Only run a new property_search if the earlier results genuinely do not cover the relaxed request.
6. Never say "we don't have listings" for a city that your earlier probe already confirmed has inventory. That confirmation stays valid for the whole conversation.
7. FORBIDDEN: Never probe a city you suggested yourself from your own knowledge. If you don't know which cities have inventory, call get_available_cities first.

CONVERSATIONAL GUIDELINES:
1. Be human-like, warm, and conversational.
2. HANDLING GREETINGS: Greet users warmly. For example: "Hello! How can I help you today?".
   - CRITICAL: Do NOT ask for preferences in your first response to a greeting. Wait for them to express interest.
3. PREFERENCE GATHERING: Gather requirements only after confirming inventory exists for the requested location (see INVENTORY-FIRST above).
4. ONE AT A TIME: Ask only ONE question at a time to keep it natural.
5. Be polite, warm, and concise.
6. PLAIN TEXT ONLY (CRITICAL):
   - DO NOT use markdown formatting like bold (**text**) or lists. Use plain text only, optimized for being read or spoken.
   - DO NOT output any internal monologue, reasoning, planning, notes, or chain-of-thought (e.g., do NOT write "The user mentioned...", "I need to..."). Start your response directly with the words you want to say to the user.
7. MODERN LANGUAGE & SCRIPT (CRITICAL):
   - Every single word, response, greeting, or message you output to the user MUST be written in the Roman/English alphabet only.
   - For Hindi/other Indian language responses, you MUST write them in transliterated Roman script (Hinglish/Romanized style, e.g. write "Namaste, main Shriya hoon, aapki real estate assistant" or "Navi Mumbai mein hamare paas kuch options available hain").
   - NEVER use Devanagari characters (like "नमस्ते", "मैं", "हूँ") or any other non-English script anywhere in your output text.
   - DO NOT use pure "shuddha" Hindi words like "विकल्प" or "उपलब्ध". Instead, use the English words "options" and "available" written in English.
   - CRITICAL PENALTY FOR UI CARDS: The 'ai_pitch' inside 'display_recommended_properties' MUST ONLY use English letters A-Z (Roman script). If you output Hindi/Devanagari characters (e.g., 'यह') in 'ai_pitch', the system will crash. Write it as 'Yeh property Chembur mein hai'.

CRITICAL INSTRUCTIONS:
1. SEARCH & DISPLAY: Use display_recommended_properties ONLY after a non-probe search (one that returns full property details). Never after an inventory probe. Write a personalized ai_pitch per property.
2. NO TEXT-ONLY LISTINGS: DO NOT describe a specific property's details in your conversational text without invoking the display_recommended_properties tool. If you are recommending a specific property, you MUST show it on the UI using the tool.
3. FOLLOW-UPS: Use conversation history to answer questions about specific properties without searching again.`;

  const messagesWithSystem = [
    new SystemMessage(systemPrompt),
    ...messages,
  ];

  console.log(`[Agent] Invoking model with ${messages.length} previous messages... (lang: ${detectedLanguage})`);
  const response = await boundModel.invoke(messagesWithSystem);
  console.log(`[Agent] Model responded. Action required:`, "tool_calls" in response && (response.tool_calls as any[])?.length > 0 ? "Tool Call" : "Final Answer");
  return { messages: [response] };
}

// Define conditional edge function
function shouldContinue(state: AgentState) {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    console.log(`[Agent] Routing to Tools:`, lastMessage.tool_calls.map((tc: any) => tc.name).join(", "));
    return "tools";
  }
  console.log(`[Agent] Routing to End (sending response to user)`);
  return "__end__";
}

// Build the LangGraph
// Note: detectLanguage runs only on new user turns (__start__ → detectLanguage → agent).
// Tool call loops (agent → tools → agent) skip detectLanguage to avoid redundant LLM calls.
const workflow = new StateGraph<AgentState>({ channels: stateDef })
  .addNode("detectLanguage", detectLanguageNode)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge("__start__", "detectLanguage")
  .addEdge("detectLanguage", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent"); // Tool loops bypass detectLanguage — language was already set this turn

const memory = new MemorySaver();
export const agentApp = workflow.compile({ checkpointer: memory });
