import axios from "axios";
import { env } from "../config/env.config";

const EMBEDDING_MODELS = [
  "gemini-embedding-001",
  "embedding-001",
  "text-embedding-004",
] as const;

export interface ListingVectorPayload {
  title?: string;
  description?: string;
  metadata?: Record<string, any>;
  location?: Record<string, any>;
  project?: {
    title?: string;
    developer?: string;
    locality?: string;
    city?: string;
  } | null;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const input = String(text || "").trim();
  if (!input) {
    throw new Error("Embedding input text cannot be empty");
  }

  for (const modelName of EMBEDDING_MODELS) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent`,
        {
          model: `models/${modelName}`,
          content: {
            parts: [{ text: input }],
          },
        },
        {
          params: { key: env.GEMINI_API_KEY },
        }
      );

      const values = response?.data?.embedding?.values;
      if (Array.isArray(values) && values.length > 0) {
        return values;
      }
    } catch (error: any) {
      const status = error?.response?.status;
      const apiMessage = error?.response?.data?.error?.message;
      console.error("[VectorUtil] Embedding model attempt failed", {
        modelName,
        status,
        error: apiMessage || error?.message,
      });
    }
  }

  throw new Error("Failed to generate embedding with available Gemini embedding models");
}
