import React, { useEffect, useState } from 'react';
import { MessageSquare, Mic as MicIcon, Plus } from 'lucide-react';
import { ChatApp } from '../ChatApp';
import { VoiceMode } from './VoiceMode';
import { PreferencesProvider, usePreferences } from '../PreferencesContext';
import { ShortlistDrawer } from './ShortlistDrawer';
import { Heart } from 'lucide-react';

const ChatViewModeContent: React.FC = () => {
  const [mode, setMode] = useState<'text' | 'voice'>(() => {
    const savedMode = sessionStorage.getItem('chatMode');
    return (savedMode === 'voice' || savedMode === 'text') ? savedMode : 'text';
  });

  useEffect(() => {
    sessionStorage.setItem('chatMode', mode);
  }, [mode]);

  const formatPrice = (price: number) => {
    if (price >= 10000000) {
      return `₹${(price / 10000000).toFixed(2)} Cr`;
    } else if (price >= 100000) {
      return `₹${(price / 100000).toFixed(2)} Lac`;
    }
    return `₹${price.toLocaleString('en-IN')}`;
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col text-foreground">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-white/88 px-4 py-3 shadow-sm backdrop-blur-xl sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm shadow-primary/10">
            <MessageSquare className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">Shriya</h1>
            <p className="truncate text-xs text-muted-foreground">Property assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ShortlistButton />
          <button
            onClick={() => {
              const event = new CustomEvent('chatbot:new-chat');
              window.dispatchEvent(event);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-primary hover:text-primary hover:shadow-sm"
            aria-label="New chat / session"
            title="New session"
          >
            <Plus className="h-4 w-4" />
          </button>

          <div className="inline-flex rounded-full border border-border bg-background p-1 shadow-sm">
            <button
              onClick={() => setMode('text')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-all sm:px-4 sm:text-sm ${
                mode === 'text'
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Text
            </button>
            <button
              onClick={() => setMode('voice')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-all sm:px-4 sm:text-sm ${
                mode === 'voice'
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <MicIcon className="h-3.5 w-3.5" />
              Voice
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-transparent">
        {mode === 'text' ? <ChatApp /> : <VoiceMode formatPrice={formatPrice} />}
      </div>
      
      <ShortlistDrawer formatPrice={formatPrice} />
    </div>
  );
};

const ShortlistButton: React.FC = () => {
  const { shortlistedProperties, setIsDrawerOpen } = usePreferences();
  const count = shortlistedProperties.length;

  return (
    <button
      onClick={() => setIsDrawerOpen(true)}
      className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-primary hover:text-primary hover:shadow-sm"
      aria-label="View Shortlist"
      title="View Shortlist"
    >
      <Heart className={`h-4 w-4 ${count > 0 ? 'fill-primary text-primary' : ''}`} />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
          {count}
        </span>
      )}
    </button>
  );
};

export const ChatViewMode: React.FC = () => {
  return (
    <PreferencesProvider>
      <ChatViewModeContent />
    </PreferencesProvider>
  );
};
