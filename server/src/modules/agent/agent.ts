import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, MemorySaver, StateGraphArgs } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { propertySearchTool, getAvailableCitiesTool } from "./tools/hybridPropertySearch.tool";
import { sendMediaTool } from "./tools/sendMedia.tool";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { env } from "../../config/env.config";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export interface AgentState {
  messages: BaseMessage[];
  /** Language detected from the last HumanMessage — injected as a hard mandate into the system prompt. */
  detectedLanguage: string;
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
        ai_pitch: z.string().describe("A compelling 1-2 sentence explanation written by you on why this specific property perfectly fits the user's requirements.")
      }))
    })
  }
);

const tools = [propertySearchTool, getAvailableCitiesTool, displayPropertiesTool, sendMediaTool];
const toolNode = new ToolNode(tools);

// Main agent model
const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: env.GEMINI_API_KEY,
  temperature: 0.4,
});
const boundModel = model.bindTools(tools);

// ─────────────────────────────────────────────
// Language detection model — focused, fast, zero temperature
// Uses structured output so it can only reply with a language name
// ─────────────────────────────────────────────
const langDetectModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: env.GEMINI_API_KEY,
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
    } else if (result.script === "Roman") {
      // User wrote Hindi/Marathi in Roman letters — respond the same way (Hinglish/Romanized)
      responseStyle = `${result.language} written in Roman script (Hinglish style — use English letters to write ${result.language} words, NOT Devanagari or any Indian script characters)`;
    } else if (result.script === "Devanagari") {
      responseStyle = `${result.language} written in Devanagari script`;
    } else {
      responseStyle = result.language;
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
  const { messages, detectedLanguage } = state;

  // Hard language mandate — first line of the prompt, before everything else
  const langMandate = `LANGUAGE MANDATE (NON-NEGOTIABLE): You MUST respond entirely in ${detectedLanguage}. ` +
    `Not a single word in any other language except property names, city names, and real estate abbreviations (BHK, EMI, RERA). ` +
    `This is detected from the user's latest message and overrides everything else.\n\n`;

  const systemPrompt = `${langMandate}You are a helpful and professional real estate assistant for a developer's website.
Your goal is to assist users with their property-related questions and help them find suitable homes through natural conversation.

KNOWLEDGE & PROACTIVITY:
1. USE YOUR KNOWLEDGE: You have extensive knowledge about real estate, home-buying processes, financial terms (EMI, down payments), and various localities. Use this knowledge to provide helpful, detailed answers.
2. BE PROACTIVE: If a user asks about a locality, don't just wait for filters—tell them what makes that locality special (amenities, connectivity, lifestyle) based on your knowledge.
3. NEVER REFUSE: Do NOT say "I don't have a tool for that" or "I am only a real estate assistant." If a question is even remotely related to real estate, lifestyle, or moving, provide a helpful answer using your internal knowledge.
4. If a user asks something completely unrelated, briefly answer and then politely steer the conversation back to how you can help them find a home.
5. DEMO MODE & DUMMY ANSWERS: For demo purposes, if the user asks for specific details or information about a property (e.g. amenities, possession date, exact distance to landmarks, specific layout features, or RERA status) and that information is not available in the database, DO NOT say "I don't know" or refuse to answer. Instead, act as a knowledgeable sales agent of that property and generate a realistic, professional-sounding dummy answer on the fly using your internal intelligence. Present it confidently and naturally.

MEDIA & DOCUMENTS (IMAGES & PDFs):
1. SENDING IMAGES: If the user asks for images, photos, or pictures of a specific property, find that property using search tools or history, get its image URL (from the \`images\` array of the property data), and call the \`send_media\` tool with type='image' and the image's URL. If the property has no images, or if asked generally for images, send a dummy/placeholder image URL.
2. SENDING DOCUMENTS: If the user asks for a floor plan, brochure, price list, or any other document for a property, generate a custom PDF file name matching the request (e.g. 'Floor_Plan_Godrej_Woods.pdf', 'Brochure_Rustomjee_Crown.pdf') and call the \`send_media\` tool with type='pdf', url='/dummy.pdf', and the custom filename.


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
6. PLAIN TEXT ONLY: DO NOT use markdown formatting like bold (**text**) or lists. Use plain text only, optimized for being read or spoken.

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
