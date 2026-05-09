import { voiceAgentDefinition } from "./voice.agent";
import { env } from "../../config/env.config";

/**
 * Voice Agent Worker Entry Point
 * 
 * This file is used by the LiveKit Agents CLI to start the voice agent worker.
 * The worker joins LiveKit rooms and processes voice interactions.
 * 
 * To start the worker, run:
 *   npx livekit-agents dev
 * 
 * Environment variables required:
 *   - LIVEKIT_URL: WebSocket URL for LiveKit
 *   - LIVEKIT_API_KEY: API key for authentication
 *   - LIVEKIT_API_SECRET: API secret for authentication
 */

export default voiceAgentDefinition;
