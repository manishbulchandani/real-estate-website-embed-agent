import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatSession } from "../models/chatSession.model";

export const managePreferenceTool = tool(
  async ({ propertyId, action, sessionId }) => {
    try {
      if (!sessionId) {
        return "Error: Cannot manage preference because sessionId is missing.";
      }

      const session = await ChatSession.findOneAndUpdate(
        { sessionId },
        { $setOnInsert: { sessionId } },
        { upsert: true, new: true }
      );

      let updatedShortlist = new Set(session.shortlistedProperties || []);
      let updatedNotInterested = new Set(session.notInterestedProperties || []);

      if (action === "shortlist") {
        updatedShortlist.add(propertyId);
        updatedNotInterested.delete(propertyId);
      } else if (action === "remove_shortlist") {
        updatedShortlist.delete(propertyId);
      } else if (action === "not_interested") {
        updatedNotInterested.add(propertyId);
        updatedShortlist.delete(propertyId);
      } else if (action === "remove_not_interested") {
        updatedNotInterested.delete(propertyId);
      }

      session.shortlistedProperties = Array.from(updatedShortlist);
      session.notInterestedProperties = Array.from(updatedNotInterested);
      await session.save();

      return `Successfully applied action '${action}' for property '${propertyId}'.`;
    } catch (e) {
      console.error("[Tool] manage_property_preference failed:", e);
      return "Failed to manage property preference due to an internal error.";
    }
  },
  {
    name: "manage_property_preference",
    description: `Add or remove a property from the user's shortlist/wishlist, or mark it as not interested.
Call this when the user explicitly asks to shortlist/wishlist a property, or when they say they don't like a property. You can also proactively offer to shortlist properties they seem very interested in.
IMPORTANT: You MUST provide the current sessionId in the parameters.`,
    schema: z.object({
      propertyId: z.string().describe("The ID of the property"),
      action: z.enum(["shortlist", "remove_shortlist", "not_interested", "remove_not_interested"]).describe("The action to perform"),
      sessionId: z.string().describe("The current chat session ID. You MUST pass this accurately from your context."),
    })
  }
);
