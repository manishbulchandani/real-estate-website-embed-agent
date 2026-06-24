import React, { useEffect, useMemo } from 'react';
import type { Property } from '../types';
import { PropertyCard } from './PropertyCard';
import { usePreferences } from '../PreferencesContext';

interface PropertyCarouselProps {
  properties: Property[];
  formatPrice: (price: number) => string;
}

export const PropertyCarousel: React.FC<PropertyCarouselProps> = ({ properties, formatPrice }) => {
  const { notInterestedProperties, registerProperties } = usePreferences();

  useEffect(() => {
    registerProperties(properties);
  }, [properties, registerProperties]);

  const sortedProperties = useMemo(() => {
    return [...properties].sort((a, b) => {
      const aNot = notInterestedProperties.includes(a.id) ? 1 : 0;
      const bNot = notInterestedProperties.includes(b.id) ? 1 : 0;
      return aNot - bNot;
    });
  }, [properties, notInterestedProperties]);

  return (
    <div className="mt-2 w-full overflow-hidden">
      <div className="flex gap-4 overflow-x-auto pb-3 pr-1 scrollbar-hide snap-x snap-mandatory">
        {sortedProperties.map((property) => (
          <div key={property.id} className="snap-start">
            <PropertyCard property={property} formatPrice={formatPrice} />
          </div>
        ))}
      </div>
    </div>
  );
};
