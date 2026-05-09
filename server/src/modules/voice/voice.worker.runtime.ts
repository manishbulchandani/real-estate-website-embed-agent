import path from "node:path";
import { cli, ServerOptions } from "@livekit/agents";
import { env } from "../../config/env.config";

process.env.OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || "sk-livekit-placeholder-not-used";
process.env.OPENAI_ADMIN_KEY =
  process.env.OPENAI_ADMIN_KEY || process.env.OPENAI_API_KEY;

const workerEntry =
  env.NODE_ENV === "production"
    ? path.resolve(process.cwd(), "dist/modules/voice/voice.worker.js")
    : path.resolve(process.cwd(), "src/modules/voice/voice.worker.ts");

console.log("[Voice Worker Bootstrap] Starting LiveKit agents worker...");
console.log(`[Voice Worker Bootstrap] Agent file: ${workerEntry}`);
console.log(`[Voice Worker Bootstrap] LiveKit URL: ${env.LIVEKIT_URL}`);

cli.runApp(
  new ServerOptions({
    agent: workerEntry,
    agentName: env.LIVEKIT_AGENT_NAME || "real-estate-voice-agent",
    wsURL: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    logLevel: env.NODE_ENV === "production" ? "info" : "debug",
  }),
);