import React, { useState, useRef, useEffect } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { useSendChatMessageMutation, useGetChatHistoryQuery } from './chatApi';
import type { Message } from './types';
import { generateUUID } from '../../utils/uuid';
import { ChatInput } from './components/ChatInput';
import { MessageItem } from './components/MessageItem';
import { usePreferences } from './PreferencesContext';

interface ChatAppProps {
}

export const ChatApp: React.FC<ChatAppProps> = () => {
  const { updateFromVoice, sessionId, selectedLanguage, setSelectedLanguage } = usePreferences();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showTyping, setShowTyping] = useState(false);
  
  const [sendChatMessage, { isLoading }] = useSendChatMessageMutation();
  const { data: historyData, isFetching: isFetchingHistory } = useGetChatHistoryQuery(sessionId);

  const currentRequestRef = useRef<{ abort: () => void } | null>(null);
  const isRequestInFlightRef = useRef(false);
  const historyLoadedRef = useRef(false);
  const pendingOnAbortRef = useRef<string[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, showTyping, isFetchingHistory]);

  useEffect(() => {
    if (historyData?.success && historyData.messages && !historyLoadedRef.current) {
      historyLoadedRef.current = true;
      setMessages(historyData.messages);
    }
  }, [historyData]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (isLoading) {
      timeout = setTimeout(() => setShowTyping(true), 600);
    } else {
      setShowTyping(false);
    }
    return () => clearTimeout(timeout);
  }, [isLoading]);

  useEffect(() => {
    if (isRequestInFlightRef.current && currentRequestRef.current) {
      currentRequestRef.current.abort();
    }
    pendingOnAbortRef.current = [];
    isRequestInFlightRef.current = false;
    currentRequestRef.current = null;
    historyLoadedRef.current = false;
    setMessages([]);
  }, [sessionId]);

  const dispatchToAgent = async (messageBatch: string[]) => {
    isRequestInFlightRef.current = true;
    try {
      const promise = sendChatMessage({ sessionId, messages: messageBatch, language: selectedLanguage });
      currentRequestRef.current = promise;
      const data = await promise.unwrap();
      isRequestInFlightRef.current = false;

      if (data.success && data.messages) {
        if (data.preferences) {
          updateFromVoice(data.preferences.shortlistedProperties, data.preferences.notInterestedProperties);
        }

        const agentMessages = data.messages.map((msg: any) => ({
          id: generateUUID(),
          sender: 'agent' as const,
          type: msg.type,
          content: msg.content,
          data: msg.data,
        }));
        setMessages((prev) => [...prev, ...agentMessages]);
      }
    } catch (err: any) {
      isRequestInFlightRef.current = false;
      const isAbort = err?.name === 'AbortError' || err?.status === 'FETCH_ERROR' || err?.error?.includes?.('abort') || err?.name === 'ConditionError';
      if (!isAbort) {
        console.error('[Chat] Error:', err);
        setMessages((prev) => [
          ...prev,
          { id: generateUUID(), sender: 'agent' as const, type: 'text' as const, content: 'Something went wrong. Please try again.' },
        ]);
      }
    }

    if (pendingOnAbortRef.current.length > 0) {
      const batch = pendingOnAbortRef.current.splice(0);
      await dispatchToAgent(batch);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim()) return;

    const userMsg = inputValue.trim();
    setInputValue('');

    setMessages((prev) => [
      ...prev,
      { id: generateUUID(), sender: 'user' as const, type: 'text' as const, content: userMsg },
    ]);

    if (isRequestInFlightRef.current) {
      pendingOnAbortRef.current.push(userMsg);
      currentRequestRef.current?.abort();
      return;
    }

    await dispatchToAgent([userMsg]);
  };

  const formatPrice = (price: number) => {
    if (price >= 10000000) {
      return `₹${(price / 10000000).toFixed(2)} Cr`;
    } else if (price >= 100000) {
      return `₹${(price / 100000).toFixed(2)} Lac`;
    }
    return `₹${price.toLocaleString('en-IN')}`;
  };

  return (
    <div className="flex flex-1 min-h-0 w-full flex-col overflow-hidden bg-card/95 text-foreground">
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5">
        {isFetchingHistory ? (
          <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border/70 bg-muted/30 text-center shadow-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">Loading your conversation...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-[2rem] border border-border/70 bg-white/70 px-6 py-10 text-center shadow-sm">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm shadow-primary/10">
              <Bot className="h-8 w-8" />
            </div>
            <h2 className="max-w-md text-3xl font-semibold tracking-tight text-foreground">How can I help you today?</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground sm:text-base">
              Ask me to find properties, recommend neighborhoods, or filter by your budget and preferences.
            </p>
            <div className="mt-6 flex flex-col items-center w-full text-center gap-1.5">
              <label htmlFor="chat-lang-select" className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Select Language
              </label>
              <select
                id="chat-lang-select"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="
                  w-full max-w-[240px] rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700
                  shadow-sm outline-none transition-all duration-200 hover:border-slate-300 focus:border-blue-400
                  text-center cursor-pointer hover:bg-slate-50/50
                "
              >
                <option value="Hinglish">Hindi (Hinglish)</option>
                <option value="English">English</option>
                <option value="Marathi">Marathi (मराठी)</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {messages.map((msg) => (
              <MessageItem key={msg.id} msg={msg} formatPrice={formatPrice} />
            ))}

            {messages.length > 0 && showTyping && (
              <div className="flex max-w-[85%] flex-col items-start">
                <div className="mb-1 flex items-center gap-2 px-1">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-success">
                    <Bot className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground/80">Shriya</span>
                </div>
                <div className="flex items-center gap-3 rounded-2xl rounded-tl-sm border border-border bg-white/90 p-4 shadow-sm">
                  <div className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.3s]"></span>
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.15s]"></span>
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40"></span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
          <div ref={messagesEndRef} className="h-1" />
        </div>
      </div>

      <ChatInput 
        value={inputValue} 
        onChange={setInputValue} 
        onSend={handleSend} 
        disabled={!inputValue.trim()} 
      />
    </div>
  );
};
