import { Request, Response } from "express";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import { env } from "../../config/env.config";
import { hybridPropertySearch } from "../agent/tools/hybridPropertySearch.tool";

/**
 * Create a new voice session token for the client.
 * This allows the frontend to connect to a LiveKit room for voice chat.
 */
export const createVoiceSessionToken = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { sessionId, identity } = req.body ?? {};

    const normalizedSessionId =
      typeof sessionId === "string" && sessionId.trim().length > 0
        ? sessionId.trim()
        : crypto.randomUUID();

    const roomName = `voice-${normalizedSessionId}`;
    const participantIdentity =
      typeof identity === "string" && identity.trim().length > 0
        ? identity.trim()
        : `web-user-${crypto.randomUUID()}`;

    const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: participantIdentity,
      name: "Website User",
      metadata: JSON.stringify({
        source: "website-agent",
        sessionId: normalizedSessionId,
      }),
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    try {
      const dispatchClient = new AgentDispatchClient(
        env.LIVEKIT_URL,
        env.LIVEKIT_API_KEY,
        env.LIVEKIT_API_SECRET,
      );

      const dispatch = await dispatchClient.createDispatch(
        roomName,
        env.LIVEKIT_AGENT_NAME || "real-estate-voice-agent",
        {
          metadata: JSON.stringify({
            source: "website-agent",
            sessionId: normalizedSessionId,
            identity: participantIdentity,
          }),
        },
      );

      console.log("[Voice] Agent dispatch created:", {
        dispatchId: dispatch.id,
        roomName,
        agentName: env.LIVEKIT_AGENT_NAME || "real-estate-voice-agent",
      });
    } catch (dispatchError) {
      console.error("[Voice] Failed to create agent dispatch:", dispatchError);
    }

    res.status(200).json({
      success: true,
      roomName,
      identity: participantIdentity,
      wsUrl: env.LIVEKIT_URL,
      token: jwt,
    });
  } catch (error: any) {
    console.error("[Voice] Token creation error:", error);
    res
      .status(500)
      .json({ success: false, error: "Unable to create voice session token" });
  }
};

/**
 * Search properties for voice agent recommendations.
 * Reuses the hybrid search from the chat agent.
 */
export const searchPropertiesForVoice = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { query, filters, maxResults, excludeIds } = req.body ?? {};

    const properties = await hybridPropertySearch({
      query: typeof query === "string" ? query : undefined,
      filters: filters && typeof filters === "object" ? filters : undefined,
      maxResults:
        typeof maxResults === "number" && Number.isFinite(maxResults)
          ? Math.max(1, Math.min(20, Math.floor(maxResults)))
          : 10,
      excludeIds: Array.isArray(excludeIds)
        ? excludeIds.filter((id: unknown): id is string => typeof id === "string")
        : undefined,
    });

    res.status(200).json({
      success: true,
      properties,
    });
  } catch (error: any) {
    console.error("[Voice] Property search error:", error);
    res.status(500).json({
      success: false,
      error: "Unable to fetch voice property recommendations",
    });
  }
};
