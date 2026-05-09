import mongoose, { Schema, Document } from "mongoose";

export interface IListingMetadata {
  bhk?: number;
  bathrooms?: number;
  price?: number;
  amenities?: string[];
  nearby_amenities?: string[];
  suitability?: ("Family" | "Bachelors" | "Investment" | "Other")[];
  images?: string[];
  listing_type?: "Buy" | "Rent";
  furnished?: "Furnished" | "Semi-Furnished" | "Unfurnished";
  propertyType?: "Apartment" | "House" | "Plot" | "CommercialSpace" | "Other";
  builtUpArea?: number; // in sq ft
  carpetArea?: number; // in sq ft
  age?: number; // in years
  availableUnits?: number; // useful for project variants
  floorRange?: {
    min: number;
    max: number;
  };
  towerName?: string;
  wingName?: string;
}

export interface IListingLocation {
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
  address?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface IListing extends Document {
  // Listing info
  title: string;
  description?: string;

  // Ownership
  listedBy: mongoose.Schema.Types.ObjectId; // ref User

  // Property details
  metadata: IListingMetadata;
  location: IListingLocation;

  // Hierarchy support (optional): standalone listing OR project variant
  projectId?: mongoose.Schema.Types.ObjectId; // ref Project
  listingScope?: "standalone" | "project_variant";
  variantLabel?: string;

  // Search & matching
  interestedBuyers?: mongoose.Schema.Types.ObjectId[]; // ref Lead[]

  // Availability & Status
  isActive: boolean;
  availableFrom?: Date;

  // Tracking
  views?: number;
  inquiries?: number;

  // Vector search support
  vectorContent?: string;
  embedding?: number[];

  // Broker memory for listing-specific revelations from live coordination
  brokerNotes?: Array<{
    note: string;
    sourcePhone?: string;
    bookingId?: string;
    timestamp: Date;
  }>;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const listingMetadataSchema = new Schema<IListingMetadata>(
  {
    bhk: {
      type: Number,
      optional: true,
    },
    bathrooms: {
      type: Number,
      optional: true,
    },
    price: {
      type: Number,
      optional: true,
    },
    amenities: {
      type: [String],
      default: [],
    },
    nearby_amenities: {
      type: [String],
      default: [],
    },
    suitability: {
      type: [
        {
          type: String,
          enum: ["Family", "Bachelors", "Investment", "Other"],
        },
      ],
      default: [],
    },
    images: {
      type: [String],
      default: [],
    },
    listing_type: {
      type: String,
      enum: ["Buy", "Rent"],
      optional: true,
    },
    furnished: {
      type: String,
      enum: ["Furnished", "Semi-Furnished", "Unfurnished"],
      optional: true,
    },
    propertyType: {
      type: String,
      enum: ["Apartment", "House", "Plot", "CommercialSpace", "Other"],
      optional: true,
    },
    builtUpArea: {
      type: Number,
      optional: true,
    },
    carpetArea: {
      type: Number,
      optional: true,
    },
    age: {
      type: Number,
      optional: true,
    },
    availableUnits: {
      type: Number,
      optional: true,
    },
    floorRange: {
      type: {
        min: Number,
        max: Number,
      },
      optional: true,
    },
    towerName: {
      type: String,
      optional: true,
    },
    wingName: {
      type: String,
      optional: true,
    },
  },
  { _id: false }
);

const listingLocationSchema = new Schema<IListingLocation>(
  {
    locality: {
      type: String,
      optional: true,
    },
    city: {
      type: String,
      optional: true,
    },
    state: {
      type: String,
      optional: true,
    },
    pincode: {
      type: String,
      optional: true,
    },
    address: {
      type: String,
      optional: true,
    },
    coordinates: {
      type: {
        latitude: Number,
        longitude: Number,
      },
      optional: true,
    },
  },
  { _id: false }
);

const listingSchema = new Schema<IListing>(
  {
    // Listing info
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      optional: true,
    },

    // Ownership - CRITICAL: Track who listed
    //  this property
    listedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      indexed: true,
    },

    // Property details
    metadata: {
      type: listingMetadataSchema,
      default: {},
    },

    location: {
      type: listingLocationSchema,
      default: {},
    },

    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      optional: true,
      indexed: true,
    },

    listingScope: {
      type: String,
      enum: ["standalone", "project_variant"],
      default: "standalone",
      indexed: true,
    },

    variantLabel: {
      type: String,
      optional: true,
    },

    // Search & matching
    interestedBuyers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Lead",
      },
    ],

    // Availability & Status
    isActive: {
      type: Boolean,
      default: true,
      indexed: true,
    },

    availableFrom: {
      type: Date,
      optional: true,
    },

    // Tracking
    views: {
      type: Number,
      default: 0,
    },

    inquiries: {
      type: Number,
      default: 0,
    },

    vectorContent: {
      type: String,
      optional: true,
    },

    embedding: {
      type: [Number],
      default: undefined,
    },

    brokerNotes: {
      type: [
        {
          note: {
            type: String,
            required: true,
          },
          sourcePhone: {
            type: String,
            optional: true,
          },
          bookingId: {
            type: String,
            optional: true,
          },
          timestamp: {
            type: Date,
            default: () => new Date(),
          },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// Create indexes for fast queries
listingSchema.index({ listedBy: 1 });
listingSchema.index({ "location.city": 1 });
listingSchema.index({ "location.locality": 1 });
listingSchema.index({ "metadata.price": 1 });
listingSchema.index({ projectId: 1, listingScope: 1 });
listingSchema.index({ isActive: 1 });
listingSchema.index({
  "location.coordinates": "2dsphere",
}); // For geospatial queries

export const Listing = mongoose.model<IListing>("Listing", listingSchema);
