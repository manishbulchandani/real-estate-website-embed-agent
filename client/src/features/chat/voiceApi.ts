import { baseApi } from '../../app/baseApi';

export interface VoiceSessionConfig {
  token: string;
  roomName: string;
  wsUrl: string;
  identity: string;
}

export interface VoiceTokenRequest {
  sessionId?: string;
  identity?: string;
}

export interface Property {
  id: string;
  title: string;
  description: string;
  price: number;
  bhk: number;
  propertyType: string;
  furnished: string;
  builtUpArea: number | null;
  age: number | null;
  listingType: string;
  listingScope: string;
  variantLabel: string | null;
  project: {
    id: string;
    title: string;
    developer: string;
    webpageUrl: string | null;
    locality: string;
    city: string;
    images: string[];
    priceRange: {
      min: number | null;
      max: number | null;
    } | null;
  } | null;
  locality: string;
  city: string;
  address: string;
  images: string[];
  bestFor: string;
  amenities: string;
  nearbyAmenities: string;
  availableFrom: string | null;
  ai_pitch?: string;
}

export interface VoiceRecommendationsRequest {
  query?: string;
  filters?: {
    bhk?: number | number[];
    budgetMin?: number;
    budgetMax?: number;
    locality?: string;
    city?: string;
    listing_type?: string | string[];
    suitability?: string[];
  };
  maxResults?: number;
  excludeIds?: string[];
}

export interface VoiceRecommendationsResponse {
  properties: Property[];
  error?: string;
}

export const voiceApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    createVoiceToken: builder.mutation<VoiceSessionConfig, VoiceTokenRequest>({
      query: (body) => ({
        url: '/voice/token',
        method: 'POST',
        body,
      }),
    }),
    getVoiceRecommendations: builder.mutation<
      VoiceRecommendationsResponse,
      VoiceRecommendationsRequest
    >({
      query: (body) => ({
        url: '/voice/recommendations',
        method: 'POST',
        body,
      }),
    }),
  }),
});

export const {
  useCreateVoiceTokenMutation,
  useGetVoiceRecommendationsMutation,
} = voiceApi;
