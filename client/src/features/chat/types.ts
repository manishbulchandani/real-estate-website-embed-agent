export interface Property {
  id: string;
  title: string;
  description: string;
  price: number;
  bhk: number;
  propertyType: string;
  furnished: string;
  locality: string;
  city: string;
  images: string[];
  listingType?: string;
  ai_pitch?: string;
  project?: {
    id: string;
    title: string;
    developer: string;
    webpageUrl?: string | null;
  };
}

export interface Message {
  id: string;
  sender: 'user' | 'agent';
  type: 'text' | 'properties' | 'image' | 'pdf' | 'booking';
  content?: string;
  data?: any;
}
