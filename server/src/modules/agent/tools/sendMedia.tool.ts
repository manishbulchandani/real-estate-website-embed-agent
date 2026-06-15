import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const sendMediaTool = tool(
  async (input) => {
    console.log(`[Tool: send_media] Sending media of type: ${input.type}, URL: ${input.url}, fileName: ${input.fileName}`);
    return JSON.stringify({
      success: true,
      type: input.type,
      url: input.url,
      fileName: input.fileName,
      propertyName: input.propertyName
    });
  },
  {
    name: "send_media",
    description: `Send an individual image or PDF file to the user, like a message on WhatsApp.
    
Use cases:
1. If the user asks for the image(s) of a property, find the property using search tools (or recall its images from history), and call this tool with type='image' and the property's image URL. If no property image is available or if requested generally, you can use a default dummy image.
2. If the user asks for a floor plan, brochure, price list, or any other document for a property, generate a custom PDF file name matching the request (e.g. 'Floor_Plan_Godrej_Woods.pdf', 'Brochure_Rustomjee_Crown.pdf') and call this tool with type='pdf', url='/dummy.pdf', and the custom fileName.

Parameters:
- type: 'image' or 'pdf'
- url: The image URL or '/dummy.pdf' for pdfs.
- fileName: Custom PDF filename for type='pdf' (e.g. 'Brochure_Project_Name.pdf').
- propertyName: Optional name of the property.`,
    schema: z.object({
      type: z.enum(["image", "pdf"]).describe("The type of media to send: 'image' or 'pdf'"),
      url: z.string().describe("The URL of the image. For pdfs, always use '/dummy.pdf'"),
      fileName: z.string().optional().describe("For 'pdf' type: the customized filename to display to the user (e.g. 'Brochure_Vastu_Residency.pdf')"),
      propertyName: z.string().optional().describe("The name of the property this media belongs to"),
    }),
  }
);
