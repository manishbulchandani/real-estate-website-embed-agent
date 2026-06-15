import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const bookVisitTool = tool(
  async (input) => {
    console.log(`[Tool: book_visit] Booking visit for propertyId: ${input.propertyId}, propertyName: ${input.propertyName}`);
    
    // Generate a random booking ID for mock purposes
    const bookingId = "BK-" + Math.floor(1000 + Math.random() * 9000);
    
    return JSON.stringify({
      success: true,
      bookingId,
      propertyId: input.propertyId,
      propertyName: input.propertyName,
      date: input.date,
      timeSlot: input.timeSlot,
      userName: input.userName,
      userPhone: input.userPhone,
      status: "Confirmed"
    });
  },
  {
    name: "book_visit",
    description: `Book a site visit or schedule a developer call for a specific property.
    
Before calling this tool, you MUST gather:
1. The property name and property ID of interest.
2. The user's preferred date (e.g., 'next Friday', '2026-06-25').
3. The preferred time slot (e.g., '11:00 AM', 'Morning', 'Evening').
4. The user's name.
5. The user's phone number.

Do NOT guess or invoke this tool if any of these five details are missing. Ask the user for the missing details first.`,
    schema: z.object({
      propertyId: z.string().describe("The ID of the property to book the visit/call for"),
      propertyName: z.string().describe("The name of the property"),
      date: z.string().describe("The preferred date of the visit"),
      timeSlot: z.string().describe("The preferred time slot or time of day"),
      userName: z.string().describe("The user's name"),
      userPhone: z.string().describe("The user's phone number")
    }),
  }
);
