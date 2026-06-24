import axios from "axios";
import { env } from "../config/env.config";

const EMBEDDING_MODELS = [
  "google/gemini-embedding-2",
  "google/text-embedding-004",
  "google/gemini-embedding-001",
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
        "https://openrouter.ai/api/v1/embeddings",
        {
          model: modelName,
          input: input,
        },
        {
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      const values = response?.data?.data?.[0]?.embedding;
      if (Array.isArray(values) && values.length > 0) {
        return values;
      }
    } catch (error: any) {
      const status = error?.response?.status;
      const apiMessage = error?.response?.data?.error?.message;
      console.error("[VectorUtil] OpenRouter Embedding model attempt failed", {
        modelName,
        status,
        error: apiMessage || error?.message,
      });
    }
  }

  throw new Error("Failed to generate embedding with available OpenRouter embedding models");
}
