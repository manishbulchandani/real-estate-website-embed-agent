import { Router } from "express";
import { createVoiceSessionToken, searchPropertiesForVoice } from "./voice.controller";

const router = Router();

/**
 * Create a voice session token for the frontend.
 * POST /voice/token
 * Body: { sessionId?: string, identity?: string }
 */
router.post("/token", createVoiceSessionToken);

/**
 * Search properties for voice recommendations.
 * POST /voice/recommendations
 * Body: { query?: string, filters?: {...}, maxResults?: number, excludeIds?: [...] }
 */
router.post("/recommendations", searchPropertiesForVoice);

export default router;
