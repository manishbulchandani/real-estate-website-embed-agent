import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { env } from "../../../config/env.config";

export const bookVisitTool = tool(
  async (input) => {
    console.log(`[Tool: book_visit] Submitting real visit request for propertyId: ${input.propertyId}, phone: ${input.userPhone}`);

    try {
      const response = await fetch(
        `${env.BACKEND_AGENT_URL}/api/v1/website-intake/visit-request`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.BACKEND_AGENT_SECRET}`,
          },
          body: JSON.stringify({
            name: input.userName,
            phone: input.userPhone,
            propertyId: input.propertyId,
            propertyName: input.propertyName,
            date: input.date,
            timeSlot: input.timeSlot,
            sessionId: input.sessionId,
          }),
        }
      );

      const data = await response.json() as any;

      if (!response.ok || !data.success) {
        const errorMessage = data?.error || data?.message || "Unknown error from intake service";
        console.error(`[Tool: book_visit] Backend intake failed (${response.status}):`, errorMessage);
        return JSON.stringify({
          success: false,
          error: errorMessage,
          message: "We have shared your visit request details with our team. They will reach out to you on WhatsApp to coordinate the schedule and share updates.",
        });
      }
 
      console.log(`[Tool: book_visit] Visit request submitted. LeadId: ${data.leadId}, CaseId: ${data.caseId}`);
 
      return JSON.stringify({
        success: true,
        leadId: data.leadId,
        propertyId: input.propertyId,
        propertyName: input.propertyName,
        date: input.date,
        timeSlot: input.timeSlot,
        userName: input.userName,
        userPhone: input.userPhone,
        ownerNotified: data.ownerNotified,
        status: "Submitted",
      });
    } catch (err: any) {
      console.error("[Tool: book_visit] Network/fetch error:", err?.message);
      return JSON.stringify({
        success: false,
        error: err?.message || "Network error",
        message: "We have shared your visit request details with our team. They will reach out to you on WhatsApp to coordinate the schedule and share updates.",
      });
    }
  },
  {
    name: "book_visit",
    description: `Book a site visit or schedule a developer call for a specific property.
    
Before calling this tool, you MUST explicitly obtain all five details from the user:
1. The property name and property ID of interest.
2. The user's preferred date (e.g., 'next Friday', '2026-06-25').
3. The preferred time slot (e.g., '11:00 AM', 'Morning', 'Evening').
4. The user's name.
5. The user's phone number.

Do NOT guess, auto-fill, or invoke this tool if any of these five details are missing from the conversation history. Ask the user for the missing details first.`,
    schema: z.object({
      propertyId: z.string().describe("The ID of the property to book the visit/call for"),
      propertyName: z.string().describe("The name of the property"),
      date: z.string().describe("The preferred date of the visit"),
      timeSlot: z.string().describe("The preferred time slot or time of day"),
      userName: z.string().describe("The user's name"),
      userPhone: z.string().describe("The user's phone number"),
      sessionId: z.string().describe("The current chat session ID — always pass this"),
    }),
  }
);
