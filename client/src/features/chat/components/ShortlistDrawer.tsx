import React from 'react';
import { X, Heart, ExternalLink } from 'lucide-react';
import { usePreferences } from '../PreferencesContext';

interface ShortlistDrawerProps {
  formatPrice: (price: number) => string;
}

export const ShortlistDrawer: React.FC<ShortlistDrawerProps> = ({ formatPrice }) => {
  const { isDrawerOpen, setIsDrawerOpen, shortlistedProperties, knownProperties, togglePreference } = usePreferences();

  if (!isDrawerOpen) return null;

  const properties = shortlistedProperties
    .map(id => knownProperties[id])
    .filter(Boolean);

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
      window.location.href = targetUrl;
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex overflow-hidden">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" 
        onClick={() => setIsDrawerOpen(false)}
      />

      {/* Drawer */}
      <div className="absolute inset-y-0 right-0 w-full max-w-sm flex flex-col bg-white shadow-2xl transition-transform transform">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-2 text-primary">
            <Heart className="h-5 w-5 fill-primary" />
            <h2 className="text-lg font-semibold text-foreground">Shortlist</h2>
            <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              {properties.length}
            </span>
          </div>
          <button 
            onClick={() => setIsDrawerOpen(false)}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {properties.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground space-y-3">
              <Heart className="h-12 w-12 stroke-1 opacity-20" />
              <p className="text-sm">No properties in your shortlist yet.<br/>Save properties you like to review them later.</p>
            </div>
          ) : (
            properties.map((property) => (
              <div key={property.id} className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-white shadow-sm transition-all hover:shadow-md">
                <button 
                  onClick={() => togglePreference(property.id, 'remove_shortlist')}
                  className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-red-500 shadow-sm backdrop-blur-md transition-all hover:bg-red-50 hover:scale-110"
                  aria-label="Remove from shortlist"
                >
                  <Heart className="h-4 w-4 fill-current" />
                </button>
                <div className="relative h-36 w-full overflow-hidden bg-muted">
                  {property.images && property.images.length > 0 ? (
                    <img
                      src={property.images[0]}
                      alt={property.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground/30 font-semibold uppercase tracking-widest text-xs">
                      No Image
                    </div>
                  )}
                  <div className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary shadow-sm backdrop-blur-md">
                    {property.bhk ? `${property.bhk} BHK ` : ''}{property.propertyType}
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-foreground line-clamp-1">{property.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{property.locality}, {property.city}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <p className="font-bold text-primary text-sm">
                      {property.price && property.price > 0 ? formatPrice(property.price) : 'Price on Request'}
                    </p>
                    {property.project?.webpageUrl && (
                      <button
                        onClick={() => openPropertyPage(property.project!.webpageUrl!)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                      >
                        Details <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
