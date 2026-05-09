import React, { useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (e?: React.FormEvent) => void;
  disabled: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ value, onChange, onSend, disabled }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 128)}px`;
    }
  }, [value]);

  return (
    <div className="shrink-0 border-t border-border/70 bg-white/80 px-4 py-4 backdrop-blur-xl sm:px-6">
      <form
        onSubmit={onSend}
        className="mx-auto flex max-w-5xl items-end gap-3 rounded-[1.5rem] border border-border bg-white/90 p-2.5 shadow-[0_12px_40px_rgba(15,23,42,0.08)] transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15"
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Type your message here..."
          className="w-full min-h-[44px] max-h-32 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none md:text-base scrollbar-hide"
          rows={1}
        />
        <button
          type="submit"
          disabled={disabled}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20 transition-all hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          <Send className="h-4.5 w-4.5" />
        </button>
      </form>
    </div>
  );
};
