import React from 'react';
import { Home, Plus } from 'lucide-react';

interface ChatHeaderProps {
  onNewChat: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ onNewChat }) => {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border/70 bg-white/80 px-4 py-4 shadow-sm backdrop-blur-xl sm:px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm shadow-primary/10">
          <Home className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Shriya</h1>
          <p className="text-sm text-muted-foreground">Your Property Advisor</p>
        </div>
      </div>
      <button
        onClick={onNewChat}
        className="flex h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-medium text-secondary-foreground transition-all hover:-translate-y-0.5 hover:border-primary hover:text-primary hover:shadow-sm"
        title="New Chat"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">New Chat</span>
      </button>
    </header>
  );
};
