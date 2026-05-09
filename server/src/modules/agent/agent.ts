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
  temperature: 0.2,
});

// Bind tools to the model
const boundModel = model.bindTools(tools);

// Define the logic that calls the model
async function callModel(state: AgentState) {
  const { messages } = state;
  const systemPrompt = `You are a helpful and professional real estate assistant for a developer's website. 
Your goal is to help users find their ideal property based on their requirements.

CONVERSATIONAL GUIDELINES:
1. Be human-like and conversational. Start by acknowledging the user's input before asking follow-up questions.
2. DO NOT ask for everything at once (budget, BHK, locality, etc.). 
3. Ask only ONE question at a time to keep the conversation natural. For example, start with their preferred locality, then in the next turn ask about BHK, then budget.
4. If the user provides multiple pieces of information, acknowledge them all but ask only one follow-up for missing info.
5. Be polite, warm, and concise.
6. DO NOT use markdown formatting like bold (**text**) in your responses. Use plain text only. For lists, you can use single asterisks (*) which will be rendered as bullet points, or simple dashes (-) and numbers (1.).

CRITICAL INSTRUCTIONS:
1. When you search for properties and find results, you MUST use the \`display_recommended_properties\` tool to show them to the user. For each property you choose to show, write a highly customized \`ai_pitch\` explaining exactly why it matches their specific needs based on its amenities, locality, etc.
2. DO NOT list property details in your normal text response. Just say something brief like "I've found some excellent options for you. Here they are:" and let the \`display_recommended_properties\` tool handle the UI.
3. Each property in the search results has an ID. If the user asks a follow-up question about a specific property (e.g. "Tell me more about the first one" or "Does the villa have a pool?"), use your conversation history context to provide detailed answers without searching again.`;

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
