import React, { useState, useRef } from 'react';
import { Home, Bot, Image as ImageIcon, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import type { Property } from '../types';

interface PropertyCardProps {
  property: Property;
  formatPrice: (price: number) => string;
}

export const PropertyCard: React.FC<PropertyCardProps> = ({ property, formatPrice }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const openPropertyPage = (targetUrl: string) => {
    try {
      const url = new URL(targetUrl, window.location.href);
      url.searchParams.set('chatbot', 'open');
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'chatbot:navigate', url: url.toString() }, '*');
        return;
      }
      window.location.href = url.toString();
    } catch {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'chatbot:navigate', url: targetUrl }, '*');
        return;
      }
      window.location.href = targetUrl;
    }
  };

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      if (clientWidth > 0) {
        const index = Math.round(scrollLeft / clientWidth);
        if (index !== currentIndex) {
          setCurrentIndex(index);
        }
      }
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { clientWidth } = scrollRef.current;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -clientWidth : clientWidth,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="flex w-[290px] shrink-0 flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg md:w-[340px]">
      <div className="relative h-52 overflow-hidden bg-muted group/image">
        <div 
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth scrollbar-hide"
        >
          {property.images && property.images.length > 0 ? (
            property.images.map((img, idx) => (
              <img
                key={idx}
                src={img}
                alt={`${property.title} ${idx + 1}`}
                className="h-full w-full shrink-0 snap-center object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ))
          ) : (
            <div className="flex h-full w-full shrink-0 snap-center items-center justify-center text-muted-foreground">
              <Home className="h-8 w-8 opacity-50" />
            </div>
          )}
        </div>

        {/* Badges and Indicators */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary shadow-sm backdrop-blur-md">
          {property.bhk ? `${property.bhk} BHK ` : ''}{property.propertyType}
        </div>

        {property.images && property.images.length > 1 && (
          <>
            {/* Navigation Arrows */}
            <button 
              onClick={(e) => { e.stopPropagation(); scroll('left'); }}
              className={`absolute left-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-md transition-all hover:bg-black/40 ${currentIndex === 0 ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover/image:opacity-100'}`}
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); scroll('right'); }}
              className={`absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-md transition-all hover:bg-black/40 ${currentIndex === property.images.length - 1 ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover/image:opacity-100'}`}
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            {/* Photo Counter */}
            <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-1 text-[10px] font-bold text-white shadow-sm backdrop-blur-md">
              <ImageIcon className="h-3 w-3" />
              <span>{currentIndex + 1} / {property.images.length}</span>
            </div>

            {/* Dots */}
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
              {property.images.map((_, idx) => (
                <div 
                  key={idx} 
                  className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                    idx === currentIndex ? 'bg-white w-4' : 'bg-white/40'
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        {property.project?.title && (
          <div className="mb-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              {property.project.title}
            </p>
          </div>
        )}
        <h3 className="font-bold text-lg text-foreground mb-1 line-clamp-1">{property.title}</h3>
        <p className="text-xs text-muted-foreground mb-4">
          {property.locality}, {property.city}
        </p>

        <div className="mt-auto pt-4 border-t border-border/60">
          <p className={`${property.price && property.price > 0 ? 'text-xl font-black text-primary' : 'text-sm font-semibold text-muted-foreground'} mb-4`}>
            {property.price && property.price > 0 ? formatPrice(property.price) : 'Price on Request'}
          </p>

          {property.ai_pitch && (
            <div className="relative pl-4 border-l-2 border-primary/30">
              <Bot className="absolute -left-[11px] top-0 h-5 w-5 rounded-full bg-white p-1 text-primary" />
              <p className="text-xs text-secondary-foreground leading-relaxed italic">
                {property.ai_pitch}
              </p>
            </div>
          )}

          {property.project?.webpageUrl && (
            <div className="mt-4">
              <button
                onClick={(e) => { e.stopPropagation(); openPropertyPage(property.project!.webpageUrl!); }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/10"
                aria-label={`View ${property.project?.title} on website`}
              >
                <ExternalLink className="h-4 w-4" />
                View Project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
