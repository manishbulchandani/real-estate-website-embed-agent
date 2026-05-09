import React from 'react';
import type { Property } from '../types';
import { PropertyCard } from './PropertyCard';

interface PropertyCarouselProps {
  properties: Property[];
  formatPrice: (price: number) => string;
}

export const PropertyCarousel: React.FC<PropertyCarouselProps> = ({ properties, formatPrice }) => {
  return (
    <div className="mt-2 w-full overflow-hidden">
      <div className="flex gap-4 overflow-x-auto pb-3 pr-1 scrollbar-hide snap-x snap-mandatory">
        {properties.map((property) => (
          <div key={property.id} className="snap-start">
            <PropertyCard property={property} formatPrice={formatPrice} />
          </div>
        ))}
      </div>
    </div>
  );
};
