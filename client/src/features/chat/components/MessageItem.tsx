import React from 'react';
import { User, Bot } from 'lucide-react';
import type { Message } from '../types';
import { PropertyCarousel } from './PropertyCarousel';

interface MessageItemProps {
  msg: Message;
  formatPrice: (price: number) => string;
}

export const MessageItem: React.FC<MessageItemProps> = ({ msg, formatPrice }) => {
  const isUser = msg.sender === 'user';

  const renderContent = (content: string) => {
    if (!content) return null;
    
    // Replace markdown bullets (* ) with actual bullet points (• )
    const withBullets = content.replace(/^(\s*)\*\s+/gm, '$1• ');
    
    // Support simple bolding **text**
    const parts = withBullets.split(/(\*\*.*?\*\*)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index} className="font-semibold text-inherit">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  console.log('Rendering MessageItem for message:', msg);

  return (
    <div className={`flex max-w-[92%] flex-col sm:max-w-[86%] ${isUser ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
      <div className={`mb-1 flex items-center gap-2 px-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isUser ? 'bg-primary' : 'bg-success'
        }`}>
          {isUser ? <User className="h-3.5 w-3.5 text-white" /> : <Bot className="h-3.5 w-3.5 text-white" />}
        </div>
        <span className="text-xs font-medium text-muted-foreground/80">
          {isUser ? 'You' : 'Shriya'}
        </span>
      </div>

      {msg.type === 'text' && msg.content && (
        <div
          className={`whitespace-pre-wrap rounded-[1.35rem] border px-4 py-3.5 leading-relaxed shadow-sm ${
            isUser
              ? 'rounded-tr-sm border-primary bg-primary text-primary-foreground shadow-primary/10'
              : 'rounded-tl-sm border-border/70 bg-white/90 text-foreground'
          }`}
        >
          {renderContent(msg.content)}
        </div>
      )}

      {msg.type === 'properties' && msg.data && (
        <PropertyCarousel properties={msg.data} formatPrice={formatPrice} />
      )}
    </div>
  );
};
