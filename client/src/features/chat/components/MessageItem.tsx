import React from 'react';
import { User, Bot, FileText } from 'lucide-react';
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

      {msg.type === 'image' && msg.content && (
        <div className="rounded-[1.35rem] overflow-hidden border border-border/70 bg-white shadow-sm p-1 max-w-[280px] sm:max-w-xs mt-1">
          <img
            src={msg.content}
            alt={msg.data?.propertyName || 'Property Image'}
            className="w-full h-auto rounded-[1rem] object-cover max-h-52"
          />
        </div>
      )}

      {msg.type === 'pdf' && msg.content && (
        <a
          href={msg.content}
          download={msg.data?.fileName || 'document.pdf'}
          className="flex items-center gap-3 rounded-[1.35rem] border border-border/70 bg-white/90 px-4 py-3 shadow-sm hover:bg-muted/30 transition-colors cursor-pointer text-foreground max-w-[280px] sm:max-w-xs mt-1"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600">
            <FileText className="h-6 w-6" />
          </div>
          <div className="flex flex-col overflow-hidden text-left">
            <span className="text-sm font-medium text-foreground truncate max-w-[160px] sm:max-w-[190px]">
              {msg.data?.fileName || 'document.pdf'}
            </span>
            <span className="text-xs text-muted-foreground">
              Click to download PDF
            </span>
          </div>
        </a>
      )}
    </div>
  );
};
