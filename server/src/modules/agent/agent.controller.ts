import { Request, Response } from "express";
import { agentApp } from "./agent";
import { Project } from "../properties/models/project.model";
import { Listing } from "../properties/models/listing.model";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChatSession } from "./models/chatSession.model";

const mapListingToProperty = (p: any): any => {
  const listingImages = Array.isArray(p.metadata?.images) ? p.metadata.images : [];
  const project = p.projectId && typeof p.projectId === "object" ? p.projectId : null;
  const projectImages = project && Array.isArray(project.images) ? project.images : [];
  const images = listingImages.length > 0 ? listingImages : projectImages;

  return {
    id: p._id.toString(),
    title: p.title || "Property Listing",
    description: p.description || "",
    price: Number(p.metadata?.price || 0),
    bhk: Number(p.metadata?.bhk || 0),
    propertyType: String(p.metadata?.propertyType || "Property"),
    images,
    locality: p.location?.locality || "Unknown",
    city: p.location?.city || "Unknown",
    project: project ? {
      id: project._id.toString(),
      title: project.title || "",
      webpageUrl: project.webpageUrl || null
    } : null
  };
};


export const togglePropertyPreference = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { propertyId, action } = req.body;

    if (!sessionId || !propertyId || !action) {
      res.status(400).json({ success: false, error: "sessionId, propertyId, and action are required" });
      return;
    }

    const validActions = ["shortlist", "remove_shortlist", "not_interested", "remove_not_interested"];
    if (!validActions.includes(action)) {
      res.status(400).json({ success: false, error: "Invalid action" });
      return;
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

    const propertyIdsToFetch = [...new Set([...session.shortlistedProperties, ...session.notInterestedProperties])];
    let populatedProperties: any[] = [];
    if (propertyIdsToFetch.length > 0) {
      const listings = await Listing.find({ _id: { $in: propertyIdsToFetch } }).populate('projectId').lean().exec();
      populatedProperties = listings.map(mapListingToProperty);
    }

    res.status(200).json({
      success: true,
      shortlistedProperties: session.shortlistedProperties,
      notInterestedProperties: session.notInterestedProperties,
      properties: populatedProperties,
    });
  } catch (error: any) {
    console.error("Toggle Preference Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getPreferences = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      res.status(400).json({ success: false, error: "sessionId is required" });
      return;
    }

    const session = await ChatSession.findOne({ sessionId }).lean().exec();
    const shortlistedIds = session?.shortlistedProperties || [];
    const notInterestedIds = session?.notInterestedProperties || [];

    const propertyIdsToFetch = [...new Set([...shortlistedIds, ...notInterestedIds])];
    let populatedProperties: any[] = [];
    if (propertyIdsToFetch.length > 0) {
      const listings = await Listing.find({ _id: { $in: propertyIdsToFetch } }).populate('projectId').lean().exec();
      populatedProperties = listings.map(mapListingToProperty);
    }

    res.status(200).json({
      success: true,
      shortlistedProperties: shortlistedIds,
      notInterestedProperties: notInterestedIds,
      properties: populatedProperties
    });
  } catch (error: any) {
    console.error("Get Preferences Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const chatWithAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, message, messages: messagesArray } = req.body;

    if (!sessionId || (!message && !messagesArray?.length)) {
      res.status(400).json({ success: false, error: "sessionId and message(s) are required" });
      return;
    }

    const messageTexts: string[] = messagesArray?.length ? messagesArray : [message];

    const initialState = {
      messages: messageTexts.map((m: string) => new HumanMessage(m)),
      sessionId: sessionId,
    };

    const abortController = new AbortController();
    res.on('close', () => {
      // Only abort if the response hasn't been sent yet (client disconnected early)
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const config = {
      configurable: { thread_id: sessionId },
      signal: abortController.signal
    };

    // agentApp.invoke will process the new message and run through the nodes
    let result;
    try {
      result = await agentApp.invoke(initialState, config);
    } catch (e: any) {
      if (e.name === 'AbortError' || e.message?.includes('abort')) {
        return;
      }
      throw e;
    }

    const messages = result.messages as any[];
    const outputMessages: any[] = [];

    // Extract the latest AI message and any Tool messages that occurred after the last Human message
    let lastHumanIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i] instanceof HumanMessage) {
        lastHumanIndex = i;
        break;
      }
    }

    const newMessages = messages.slice(lastHumanIndex + 1);

    // Pass 1: get property_search results for full data
    const allPropertiesFound = new Map<string, any>();
    for (const msg of newMessages) {
      if (msg instanceof ToolMessage && msg.name === "property_search") {
        try {
          const props = JSON.parse(msg.content as string);
          if (Array.isArray(props)) {
            props.forEach(p => allPropertiesFound.set(p.id.toString(), p));
          }
        } catch (e) { }
      }
    }

    for (const msg of newMessages) {
      if (msg instanceof ToolMessage && msg.name === "display_recommended_properties") {
        try {
          const displayed = JSON.parse(msg.content as string);
          if (Array.isArray(displayed) && displayed.length > 0) {
            const enrichedProperties = await Promise.all(displayed.map(async (d: any) => {
              const fullProp = allPropertiesFound.get(d.id?.toString());
              if (!fullProp) return null;
              // If project webpageUrl is missing but project id exists, try to fetch it from DB
              if (fullProp.project && !fullProp.project.webpageUrl && fullProp.project.id) {
                try {
                  const proj = await Project.findById(fullProp.project.id).select('webpageUrl').lean().exec();
                  if (proj && proj.webpageUrl) {
                    fullProp.project = { ...fullProp.project, webpageUrl: String(proj.webpageUrl) };
                  }
                } catch (e) {
                  console.warn(`[Agent] Failed to fetch project webpageUrl for project ${fullProp.project.id}:`, (e as Error)?.message || e);
                  // ignore DB lookup failures and continue
                }
              }
              return { ...fullProp, ai_pitch: d.ai_pitch };
            }));
            const filtered = enrichedProperties.filter(Boolean as any);

            if (filtered.length > 0) {
              outputMessages.push({
                type: "properties",
                data: filtered,
              });
            }
          }
        } catch (e) {
          console.error("Failed to parse tool message content", e);
        }
      } else if (msg instanceof ToolMessage && msg.name === "send_media") {
        try {
          const mediaInfo = JSON.parse(msg.content as string);
          outputMessages.push({
            type: mediaInfo.type,
            content: mediaInfo.url,
            data: {
              fileName: mediaInfo.fileName,
              propertyName: mediaInfo.propertyName,
            }
          });
        } catch (e) {
          console.error("Failed to parse send_media tool content", e);
        }
      } else if (msg instanceof AIMessage) {
        if (msg.content && typeof msg.content === "string" && msg.content.trim().length > 0) {
          outputMessages.push({
            type: "text",
            content: msg.content,
          });
        }
      }
    }

    // Ensure we send properties last if both text and properties exist
    outputMessages.sort((a, b) => {
      if (a.type === "text" && b.type === "properties") return -1;
      if (a.type === "properties" && b.type === "text") return 1;
      return 0;
    });

    const persistedMessages = [
      ...messageTexts.map((content) => ({
        id: crypto.randomUUID(),
        sender: "user" as const,
        type: "text" as const,
        content,
      })),
      ...outputMessages.map((message) => ({
        id: crypto.randomUUID(),
        sender: "agent" as const,
        type: message.type as any,
        content: typeof message.content === "string" ? message.content : undefined,
        data: message.data,
      })),
    ];

    if (persistedMessages.length > 0) {
      await ChatSession.findOneAndUpdate(
        { sessionId },
        {
          $setOnInsert: { sessionId },
          $push: { messages: { $each: persistedMessages } },
        },
        { upsert: true, new: true },
      ).exec();
    }

    const updatedSession = await ChatSession.findOne({ sessionId }).lean().exec();

    const propertyIdsToFetch = [...new Set([...(updatedSession?.shortlistedProperties || []), ...(updatedSession?.notInterestedProperties || [])])];
    let populatedProperties: any[] = [];
    if (propertyIdsToFetch.length > 0) {
      const listings = await Listing.find({ _id: { $in: propertyIdsToFetch } }).populate('projectId').lean().exec();
      populatedProperties = listings.map(mapListingToProperty);
    }

    res.status(200).json({
      success: true,
      messages: outputMessages,
      preferences: {
        shortlistedProperties: updatedSession?.shortlistedProperties || [],
        notInterestedProperties: updatedSession?.notInterestedProperties || [],
        properties: populatedProperties
      }
    });
  } catch (error: any) {
    console.error("Agent Chat Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getChatHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      res.status(400).json({ success: false, error: "sessionId is required" });
      return;
    }

    const persistedSession = await ChatSession.findOne({ sessionId }).lean().exec();
    if (persistedSession?.messages?.length) {
      res.status(200).json({
        success: true,
        messages: persistedSession.messages,
      });
      return;
    }

    const config = { configurable: { thread_id: sessionId } };
    const state = await agentApp.getState(config);

    if (!state || !state.values || !state.values.messages) {
      res.status(200).json({ success: true, messages: [] });
      return;
    }

    const messages = state.values.messages;
    const outputMessages: any[] = [];

    // First pass: collect all properties from property_search
    const allPropertiesFound = new Map<string, any>();
    for (const msg of messages) {
      if (msg instanceof ToolMessage && msg.name === "property_search") {
        try {
          const props = JSON.parse(msg.content as string);
          if (Array.isArray(props)) {
            props.forEach(p => allPropertiesFound.set(p.id.toString(), p));
          }
        } catch (e) { }
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg instanceof HumanMessage) {
        outputMessages.push({
          id: msg.id || i.toString(),
          sender: "user",
          type: "text",
          content: msg.content,
        });
      } else if (msg instanceof AIMessage) {
        if (msg.content && typeof msg.content === "string" && msg.content.trim().length > 0) {
          outputMessages.push({
            id: msg.id || i.toString(),
            sender: "agent",
            type: "text",
            content: msg.content,
          });
        }
      } else if (msg instanceof ToolMessage && msg.name === "display_recommended_properties") {
        try {
          const displayed = JSON.parse(msg.content as string);
          if (Array.isArray(displayed) && displayed.length > 0) {
            const enrichedProperties = await Promise.all(displayed.map(async (d: any) => {
              const fullProp = allPropertiesFound.get(d.id?.toString());
              if (!fullProp) return null;
              if (fullProp.project && !fullProp.project.webpageUrl && fullProp.project.id) {
                try {
                  const proj = await Project.findById(fullProp.project.id).select('webpageUrl').lean().exec();
                  if (proj && proj.webpageUrl) {
                    fullProp.project = { ...fullProp.project, webpageUrl: String(proj.webpageUrl) };
                    console.log(`[Agent] Enriched property ${fullProp.id} with project webpageUrl: ${proj.webpageUrl}`);
                  }
                } catch (e) {
                  console.warn(`[Agent] Failed to fetch project webpageUrl for project ${fullProp.project.id}:`, (e as Error)?.message || e);
                }
              }
              return { ...fullProp, ai_pitch: d.ai_pitch };
            }));
            const filtered = enrichedProperties.filter(Boolean as any);

            if (filtered.length > 0) {
              outputMessages.push({
                id: msg.id || i.toString(),
                sender: "agent",
                type: "properties",
                data: filtered,
              });
            }
          }
        } catch (e) { }
      } else if (msg instanceof ToolMessage && msg.name === "send_media") {
        try {
          const mediaInfo = JSON.parse(msg.content as string);
          outputMessages.push({
            id: msg.id || i.toString(),
            sender: "agent",
            type: mediaInfo.type,
            content: mediaInfo.url,
            data: {
              fileName: mediaInfo.fileName,
              propertyName: mediaInfo.propertyName,
            }
          });
        } catch (e) { }
      }
    }

    res.status(200).json({
      success: true,
      messages: outputMessages,
    });
  } catch (error: any) {
    console.error("Agent History Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};
