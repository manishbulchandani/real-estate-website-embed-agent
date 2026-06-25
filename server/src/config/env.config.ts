import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ override: true });

const envSchema = z.object({
  NODE_ENV: z
    .enum(["staging", "production", "development"])
    .default("development"),
  PORT: z.string().transform(Number).default(8000),

  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  FRONTEND_URL: z.string().url("FRONTEND_URL must be a valid URL"),
  GEMINI_API_KEY: z.string().optional(),
  LIVEKIT_URL: z.string().url("LIVEKIT_URL must be a valid URL"),
  LIVEKIT_API_KEY: z.string().min(1, "LIVEKIT_API_KEY is required"),
  LIVEKIT_API_SECRET: z.string().min(1, "LIVEKIT_API_SECRET is required"),
  LIVEKIT_AGENT_NAME: z.string().default("real-estate-voice-agent"),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  STT_PROVIDER: z.enum(["deepgram", "elevenlabs"]).default("deepgram"),
  ELEVENLABS_STT_MODEL: z.string().default("scribe_v2_realtime"),
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_VOICE_MODEL: z.string().default("google/gemini-2.5-flash"),
  OPENROUTER_VOICE_FALLBACK_MODEL: z.string().default("openai/gpt-4.1-mini"),
  OPENROUTER_CHAT_MODEL: z.string().default("google/gemini-2.5-flash"),

  // Internal backend-agent communication
  BACKEND_AGENT_URL: z.string().url("BACKEND_AGENT_URL must be a valid URL").default("http://localhost:8000"),
  BACKEND_AGENT_SECRET: z.string().min(1, "BACKEND_AGENT_SECRET is required"),
});

/**
 * Validate environment variables
 * This will crash the application if any required variable is missing or invalid
 */

function validateEnv() {
  try {
    const parsed = envSchema.safeParse(process.env);

    if (!parsed.success) {
      console.error("Invalid or missing environment variables:\n");
      parsed.error.issues.forEach((issue) => {
        console.error(`  ❌ ${issue.path.join(".")}: ${issue.message}`);
      });

      console.error(
        "\n⚠️  Please check your .env file and ensure all required variables are set correctly.\n"
      );
      process.exit(1);
    }

    return parsed.data;
  } catch (error) {
    console.error("\n❌ ENVIRONMENT CONFIGURATION ERROR\n");
    console.error(error);
    process.exit(1);
  }
}

/**
 * Validated and typed environment configuration
 * Import this instead of using process.env directly
 */
export const env = validateEnv();

/**
 * Type-safe environment configuration object
 */
export type Env = z.infer<typeof envSchema>;

// Log successful validation in development
if (env.NODE_ENV === "development") {
  console.log("✓ Environment variables validated successfully");
}
