import mongoose, { Document, Schema } from "mongoose";

export type ChatMessageSender = "user" | "agent";
export type ChatMessageType = "text" | "properties";

export interface IChatMessage {
  id?: string;
  sender: ChatMessageSender;
  type: ChatMessageType;
  content?: string;
  data?: unknown;
}

export interface IChatSession extends Document {
  sessionId: string;
  messages: IChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    id: { type: String, optional: true },
    sender: { type: String, required: true, enum: ["user", "agent"] },
    type: { type: String, required: true, enum: ["text", "properties"] },
    content: { type: String, optional: true },
    data: { type: Schema.Types.Mixed, optional: true },
  },
  { _id: false },
);

const chatSessionSchema = new Schema<IChatSession>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    messages: { type: [chatMessageSchema], default: [] },
  },
  { timestamps: true },
);

export const ChatSession = mongoose.model<IChatSession>("ChatSession", chatSessionSchema);