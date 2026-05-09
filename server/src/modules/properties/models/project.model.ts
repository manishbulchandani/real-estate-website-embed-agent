import mongoose, { Document, Schema } from "mongoose";

export interface IProjectLocation {
  address?: string;
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface IProject extends Document {
  title: string;
  description?: string;
  developer?: string;
  webpageUrl?: string;
  listedBy: mongoose.Schema.Types.ObjectId; // ref User
  location: IProjectLocation;
  totalFloors?: number;
  totalUnits?: number;
  amenities: string[];
  nearbyAmenities: string[];
  images: string[];
  priceRange?: {
    min: number;
    max: number;
  };
  bhkTypes: number[];
  possessionStatus?: "Ready" | "Under Construction";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const projectLocationSchema = new Schema<IProjectLocation>(
  {
    address: { type: String, optional: true },
    locality: { type: String, optional: true },
    city: { type: String, optional: true },
    state: { type: String, optional: true },
    pincode: { type: String, optional: true },
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

const projectSchema = new Schema<IProject>(
  {
    title: {
      type: String,
      required: true,
      indexed: true,
    },
    description: {
      type: String,
      optional: true,
    },
    developer: {
      type: String,
      optional: true,
    },
    webpageUrl: {
      type: String,
      optional: true,
    },
    listedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      indexed: true,
    },
    location: {
      type: projectLocationSchema,
      default: {},
    },
    totalFloors: {
      type: Number,
      optional: true,
    },
    totalUnits: {
      type: Number,
      optional: true,
    },
    amenities: {
      type: [String],
      default: [],
    },
    nearbyAmenities: {
      type: [String],
      default: [],
    },
    images: {
      type: [String],
      default: [],
    },
    priceRange: {
      type: {
        min: Number,
        max: Number,
      },
      optional: true,
    },
    bhkTypes: {
      type: [Number],
      default: [],
    },
    possessionStatus: {
      type: String,
      enum: ["Ready", "Under Construction"],
      optional: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      indexed: true,
    },
  },
  { timestamps: true }
);

projectSchema.index({ "location.city": 1, "location.locality": 1 });
projectSchema.index({ "priceRange.min": 1, "priceRange.max": 1 });
projectSchema.index({ "location.coordinates": "2dsphere" });

export const Project = mongoose.model<IProject>("Project", projectSchema);