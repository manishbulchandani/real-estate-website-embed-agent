import { baseApi } from '../../app/baseApi';

export interface ChatRequest {
  sessionId: string;
  messages: string[];
}

export interface ChatResponse {
  success: boolean;
  messages: any[];
  error?: string;
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
  }),
});

export const { useSendChatMessageMutation, useGetChatHistoryQuery } = chatApi;
