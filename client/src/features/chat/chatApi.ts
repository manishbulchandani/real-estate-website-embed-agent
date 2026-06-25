import { baseApi } from '../../app/baseApi';

export interface ChatRequest {
  sessionId: string;
  messages: string[];
  language?: string;
}

export interface ChatResponse {
  success: boolean;
  messages: any[];
  preferences?: {
    shortlistedProperties: string[];
    notInterestedProperties: string[];
  };
  error?: string;
}

export interface PreferencesResponse {
  success: boolean;
  shortlistedProperties: string[];
  notInterestedProperties: string[];
  properties?: any[];
  error?: string;
}

export interface TogglePreferenceRequest {
  sessionId: string;
  propertyId: string;
  action: 'shortlist' | 'remove_shortlist' | 'not_interested' | 'remove_not_interested';
}

export const chatApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    sendChatMessage: builder.mutation<ChatResponse, ChatRequest>({
      query: (body) => ({
        url: '/agent/chat',
        method: 'POST',
        body,
      }),
    }),
    getChatHistory: builder.query<ChatResponse, string>({
      query: (sessionId) => `/agent/chat/${sessionId}`,
    }),
    getPreferences: builder.query<PreferencesResponse, string>({
      query: (sessionId) => `/agent/chat/${sessionId}/preferences`,
    }),
    togglePreference: builder.mutation<PreferencesResponse, TogglePreferenceRequest>({
      query: (body) => ({
        url: `/agent/chat/${body.sessionId}/preferences`,
        method: 'POST',
        body: { propertyId: body.propertyId, action: body.action },
      }),
    }),
  }),
});

export const { useSendChatMessageMutation, useGetChatHistoryQuery, useGetPreferencesQuery, useTogglePreferenceMutation } = chatApi;
