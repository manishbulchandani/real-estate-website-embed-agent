import React from 'react';
import { User, Bot, FileText, Calendar, Clock, CheckCircle2 } from 'lucide-react';
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

      {msg.type === 'booking' && msg.data && (
        <div className="flex flex-col rounded-[1.5rem] border border-emerald-100 bg-emerald-50/45 p-5 shadow-sm backdrop-blur-xl max-w-[320px] sm:max-w-md mt-1.5 transition-all hover:shadow-md">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-emerald-100/60">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <span className="text-base font-semibold text-slate-950 tracking-tight">{msg.data.propertyName}</span>
            </div>
            <span className="inline-flex items-center rounded-full bg-emerald-200/60 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
              {msg.data.status || 'Confirmed'}
            </span>
          </div>
          
          <div className="mt-3.5 grid grid-cols-2 gap-3 text-xs text-slate-700 pb-3.5 border-b border-emerald-100/60">
            <div className="flex items-start gap-2">
              <Calendar className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div className="flex flex-col">
                <span className="font-semibold text-slate-400 block mb-0.5 tracking-wider uppercase text-[10px]">Date</span>
                <span className="text-slate-800 font-semibold">{msg.data.date}</span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div className="flex flex-col">
                <span className="font-semibold text-slate-400 block mb-0.5 tracking-wider uppercase text-[10px]">Time Slot</span>
                <span className="text-slate-800 font-semibold">{msg.data.timeSlot}</span>
              </div>
            </div>
          </div>

          <div className="mt-3.5 flex items-end justify-between text-xs">
            <div className="flex flex-col text-slate-600">
              <span className="font-semibold text-slate-400 tracking-wider uppercase text-[10px] mb-0.5">Visitor Contact</span>
              <span className="text-slate-800 font-bold">{msg.data.userName}</span>
              <span className="text-slate-600 font-medium">{msg.data.userPhone}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-semibold text-slate-400 tracking-wider uppercase text-[10px] mb-1">Booking ID</span>
              <span className="font-mono text-xs text-emerald-700 font-bold bg-emerald-100/70 px-2.5 py-0.5 rounded shadow-sm border border-emerald-200/30">
                {msg.data.bookingId}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
