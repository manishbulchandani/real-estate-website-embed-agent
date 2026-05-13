import { BaseMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, MemorySaver, StateGraphArgs } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { propertySearchTool } from "./tools/hybridPropertySearch.tool";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { env } from "../../config/env.config";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export interface AgentState {
  messages: BaseMessage[];
}

const stateDef: StateGraphArgs<AgentState>["channels"] = {
  messages: {
    value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
    default: () => [],
  },
};

const displayPropertiesTool = tool(
  async (input) => {
    return JSON.stringify(input.properties);
  },
  {
    name: "display_recommended_properties",
    description: "Use this tool to visually present the recommended properties to the user on the UI. You MUST call this tool after a property_search if you want the user to see the property cards.",
    schema: z.object({
      properties: z.array(z.object({
        id: z.string().describe("The ID of the property to show"),
        ai_pitch: z.string().describe("A compelling 1-2 sentence explanation written by you on why this specific property perfectly fits the user's requirements.")
      }))
    })
  }
);

const tools = [propertySearchTool, displayPropertiesTool];
const toolNode = new ToolNode(tools);

// Initialize Gemini model
const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.1-flash-lite-preview",
  apiKey: env.GEMINI_API_KEY,
  temperature: 0.4,
});

// Bind tools to the model
const boundModel = model.bindTools(tools);

// Define the logic that calls the model
async function callModel(state: AgentState) {
  const { messages } = state;
  const systemPrompt = `You are a helpful and professional real estate assistant for a developer's website. 
Your goal is to assist users with their property-related questions and help them find suitable homes through natural conversation.

KNOWLEDGE & PROACTIVITY:
1. USE YOUR KNOWLEDGE: You have extensive knowledge about real estate, home-buying processes, financial terms (EMI, down payments), and various localities. Use this knowledge to provide helpful, detailed answers.
2. BE PROACTIVE: If a user asks about a locality, don't just wait for filters—tell them what makes that locality special (amenities, connectivity, lifestyle) based on your knowledge.
3. NEVER REFUSE: Do NOT say "I don't have a tool for that" or "I am only a real estate assistant." If a question is even remotely related to real estate, lifestyle, or moving, provide a helpful answer using your internal knowledge.
4. If a user asks something completely unrelated, briefly answer and then politely steer the conversation back to how you can help them find a home.

CONVERSATIONAL GUIDELINES:
1. Be human-like, warm, and conversational. 
2. HANDLING GREETINGS: Greet users warmly. For example: "Hello! How can I help you today?". 
   - CRITICAL: Do NOT ask for preferences in your first response to a greeting. Wait for them to express interest.
3. PREFERENCE GATHERING: Start gathering requirements (Locality, Budget, BHK, etc.) only after the user expresses interest in finding properties.
4. ONE AT A TIME: Ask only ONE question at a time to keep it natural.
5. If a request is broad, ask for 1-2 missing details instead of showing results immediately.
6. Be polite, warm, and concise.
7. PLAIN TEXT ONLY: DO NOT use markdown formatting like bold (**text**) or lists. Use plain text only, optimized for being read or spoken.

CRITICAL INSTRUCTIONS:
1. SEARCH & DISPLAY: When you find properties, you MUST use the \`display_recommended_properties\` tool. Write a customized \`ai_pitch\` for each.
2. DO NOT list property details in text. Use brief lead-ins like "I've found some great options for you. Take a look:" and let the tool handle the UI.
3. FOLLOW-UPS: Use conversation history to answer questions about specific properties without searching again.`;

  const messagesWithSystem = [
    new SystemMessage(systemPrompt),
    ...messages,
  ];

  console.log(`[Agent] Invoking model with ${messages.length} previous messages...`);
  const response = await boundModel.invoke(messagesWithSystem);
  console.log(`[Agent] Model responded. Action required:`, "tool_calls" in response && (response.tool_calls as any[])?.length > 0 ? "Tool Call" : "Final Answer");
  return { messages: [response] };
}

// Define conditional edge function to determine if we need to call tools
function shouldContinue(state: AgentState) {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    console.log(`[Agent] Routing to Tools:`, lastMessage.tool_calls.map(tc => tc.name).join(", "));
    return "tools";
  }
  console.log(`[Agent] Routing to End (sending response to user)`);
  return "__end__";
}

// Build the LangGraph
const workflow = new StateGraph<AgentState>({ channels: stateDef })
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");

// We use MemorySaver for keeping state across graph runs within memory
// In production with a DB, we could use MongoDB checkpointer.
const memory = new MemorySaver();

export const agentApp = workflow.compile({ checkpointer: memory });
