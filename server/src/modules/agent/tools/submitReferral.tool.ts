import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { env } from "../../../config/env.config";

export const submitReferralTool = tool(
  async (input) => {
    console.log(`[Tool: submit_referral] Submitting referral: ${input.referrerName} referring ${input.refereeName} (${input.refereePhone})`);

    try {
      const response = await fetch(
        `${env.BACKEND_AGENT_URL}/api/v1/website-intake/referral`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.BACKEND_AGENT_SECRET}`,
          },
          body: JSON.stringify({
            referrerName: input.referrerName,
            referrerPhone: input.referrerPhone,
            refereeName: input.refereeName,
            refereePhone: input.refereePhone,
            refereeCity: input.refereeCity || undefined,
            refereeInterest: input.refereeInterest || undefined,
            sessionId: input.sessionId,
          }),
        }
      );

      const data = await response.json() as any;

      if (!response.ok || !data.success) {
        const errorMessage = data?.error || data?.message || "Unknown error from referral service";
        console.error(`[Tool: submit_referral] Backend failed (${response.status}):`, errorMessage);
        return JSON.stringify({
          success: false,
          error: errorMessage,
          message: "We had a hiccup submitting the referral. Please try again.",
        });
      }

      console.log(`[Tool: submit_referral] Referral submitted. LeadId: ${data.leadId}, CaseId: ${data.caseId}`);

      return JSON.stringify({
        success: true,
        leadId: data.leadId,
        referrerName: input.referrerName,
        refereeName: input.refereeName,
        refereeNotified: data.refereeNotified,
        status: "Submitted",
      });
    } catch (err: any) {
      console.error("[Tool: submit_referral] Network/fetch error:", err?.message);
      return JSON.stringify({
        success: false,
        error: err?.message || "Network error",
        message: "We could not submit the referral right now. Please try again in a moment.",
      });
    }
  },
  {
    name: "submit_referral",
    description: `Submit a referral when the user wants to refer someone they know who is looking for a property.

Before calling this tool, you MUST gather ALL of the following:
1. The current user's (referrer's) full name.
2. The current user's (referrer's) phone number.
3. The referred person's (referee's) full name.
4. The referred person's (referee's) phone number.

Optionally also collect (ask naturally, don't force):
5. The city/area the referee is looking in.
6. What kind of property the referee is interested in (e.g., "2BHK flat to buy", "rental apartment", etc.)

IMPORTANT:
- Do NOT call this tool until you have at least items 1–4.
- Ask for one missing detail at a time to keep the conversation warm.
- After successfully submitting, tell the user: "Thank you for the referral! We've noted [referee name]'s details and our team will reach out to them on WhatsApp shortly. You'll also receive a confirmation on WhatsApp."`,
    schema: z.object({
      referrerName: z.string().describe("The full name of the person making the referral (the current user)"),
      referrerPhone: z.string().describe("The phone number of the person making the referral"),
      refereeName: z.string().describe("The full name of the person being referred"),
      refereePhone: z.string().describe("The phone number of the person being referred"),
      refereeCity: z.string().optional().describe("The city or area the referee is interested in (if known)"),
      refereeInterest: z.string().optional().describe("What kind of property the referee is looking for (if known)"),
      sessionId: z.string().describe("The current chat session ID — always pass this"),
    }),
  }
);
