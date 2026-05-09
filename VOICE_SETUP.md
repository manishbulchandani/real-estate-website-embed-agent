# LiveKit Voice Agent Integration Setup Guide

## Overview

This project integrates a **LiveKit voice agent** into your existing real estate chatbot. Everything runs in one unified backend codebase:

- **Frontend**: React app with text chat and voice mode tabs
- **Backend API**: Express server (handles tokens, recommendations, text chat)
- **Voice Worker**: LiveKit agent process (handles voice sessions, integrates with backend API)

Both processes run from the same backend code and share configuration.

---

## Required API Keys & Environment Variables

### 1. **LiveKit Cloud Credentials**
Sign up at [cloud.livekit.io](https://cloud.livekit.io/) to get these:

- `LIVEKIT_URL` - WebSocket URL (e.g., `wss://your-project.livekit.cloud`)
- `LIVEKIT_API_KEY` - For server-side token generation
- `LIVEKIT_API_SECRET` - For server-side token generation

### 2. **Gemini API Key** (LLM)
From [Google Cloud Console](https://console.cloud.google.com/):

- `GEMINI_API_KEY` - For LLM inference (already required)

### 3. **Deepgram API Key** (STT - Speech-to-Text)
Sign up at [deepgram.com](https://deepgram.com/):

- `DEEPGRAM_API_KEY` - For voice transcription
  - Set as an environment variable OR configure in LiveKit Inference

### 4. **ElevenLabs API Key** (TTS - Text-to-Speech)
Sign up at [elevenlabs.io](https://elevenlabs.io/):

- `ELEVENLABS_API_KEY` - For voice synthesis
  - Set as an environment variable OR configure in LiveKit Inference

---

## Setup Instructions

### Step 1: Update Backend `.env` File

**File**: `server/.env`

```env
NODE_ENV=development
PORT=8000

MONGO_URI=your_mongodb_connection_string
FRONTEND_URL=http://localhost:5173

# LiveKit
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Gemini
GEMINI_API_KEY=your_gemini_key

# STT Provider (Deepgram)
DEEPGRAM_API_KEY=your_deepgram_key

# TTS Provider (ElevenLabs)
ELEVENLABS_API_KEY=your_elevenlabs_key

# Voice Agent Config
LIVEKIT_AGENT_NAME=real-estate-voice-agent
```

### Step 2: Update Frontend `.env` File

**File**: `client/.env`

```env
VITE_API_URL=http://localhost:8000/api/v1
```

### Step 3: Install Dependencies

```bash
# Backend
cd server
npm install

# Frontend
cd ../client
npm install
```

### Step 4: Build (Optional, but recommended for first-time)

```bash
# Backend
cd server
npm run build

# Frontend
cd ../client
npm run build
```

---

## Running the Project

### Option A: Two Terminals (Recommended for Development)

**Terminal 1 - Start Express Backend API:**
```bash
cd server
npm run dev
```
- API available at `http://localhost:8000/api/v1`
- Will print: `Server running in development mode on port 8000`

**Terminal 2 - Start LiveKit Voice Agent Worker:**
```bash
cd server
pnpm dev  # Or npm run dev
# Then when prompted, select the agent name "real-estate-voice-agent"
```
- Agent connects to LiveKit and waits for voice sessions
- Will print: `[Agent] Starting worker...` and connect to `LIVEKIT_URL`

**Terminal 3 - Start Frontend Dev Server:**
```bash
cd client
npm run dev
```
- Frontend available at `http://localhost:5173`
- Browser will show text chat + voice mode tabs

### Option B: Docker/Production

For production deployment, you'd typically:
1. Use Docker Compose or separate deployments
2. Start the Express server: `npm start` (after `npm run build`)
3. Start the voice agent separately as a worker service

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              Frontend (React)                │
│  [Text Chat Tab] [Voice Chat Tab]           │
└────────────────┬────────────────────────────┘
                 │ HTTP + WebSocket (LiveKit)
    ┌────────────┴────────────────┐
    │                             │
┌───▼──────────────────┐  ┌──────▼────────────────┐
│  Express API Server  │  │  LiveKit Voice Agent  │
│  - Token generation  │  │  - Voice processing   │
│  - Chat endpoint     │  │  - Property search    │
│  - Recommendations   │  │  - Data channel pub   │
└─────────┬────────────┘  └──────┬────────────────┘
          │                       │
          └───────────┬───────────┘
                      │
            ┌─────────▼──────────┐
            │  LiveKit Cloud     │
            │  - RTC media       │
            │  - Room management │
            │  - Data channels   │
            └────────────────────┘
```

---

## How It Works

### Text Mode (Existing Chat)
1. User types message in frontend
2. Frontend sends to `/api/v1/agent/chat`
3. Backend LangGraph agent processes (uses Gemini)
4. Properties displayed via carousel

### Voice Mode (New)
1. User clicks "Start Voice" button
2. Frontend requests token from `/api/v1/voice/token`
3. Backend issues JWT token via LiveKit SDK
4. Frontend connects to LiveKit room
5. Voice agent automatically joins the room (via LiveKit infrastructure)
6. Agent listens to user speech (Deepgram STT)
7. Agent processes with Gemini LLM
8. Agent speaks response (ElevenLabs TTS)
9. When properties are found, agent publishes via data channel (topic: `property_recommendations`)
10. Frontend receives and displays in carousel

---

## Data Flow for Voice Recommendations

```
User speaks → Agent STT (Deepgram) → Text
                                       ↓
                                   Gemini LLM
                                       ↓
                             Agent decides: "Search properties"
                                       ↓
                           property_search tool → Backend API
                                       ↓
                          /api/v1/voice/recommendations
                                       ↓
                          Hybrid search + Vector DB
                                       ↓
                            Properties JSON returned
                                       ↓
                       Agent calls display_recommended_properties
                                       ↓
                      Publishes JSON via data channel (reliable)
                                       ↓
                          Frontend receives packet
                                       ↓
                        Adds to voice properties carousel
                                       ↓
                           Agent speaks: "I found..."
```

---

## Frontend Component Structure

- **`ChatViewMode`** - Tabs for text/voice modes
  - **`ChatApp`** - Existing text chat (unchanged)
  - **`VoiceMode`** - New voice interface
    - Connects to LiveKit room
    - Displays AI voice status orb (animated when speaking)
    - Shows recommended properties carousel
    - Handles data channel subscriptions

---

## Environment Variables Summary

| Variable | Purpose | Source |
|----------|---------|--------|
| `LIVEKIT_URL` | WebSocket for media | LiveKit Cloud |
| `LIVEKIT_API_KEY` | Server token generation | LiveKit Cloud |
| `LIVEKIT_API_SECRET` | Server token generation | LiveKit Cloud |
| `GEMINI_API_KEY` | LLM for voice agent | Google Cloud |
| `DEEPGRAM_API_KEY` | STT (speech→text) | Deepgram |
| `ELEVENLABS_API_KEY` | TTS (text→speech) | ElevenLabs |
| `MONGO_URI` | Property database | Your DB |
| `FRONTEND_URL` | CORS origin | `http://localhost:5173` (dev) |
| `LIVEKIT_AGENT_NAME` | Worker identifier | Any string, default: `real-estate-voice-agent` |

---

## Troubleshooting

### "Failed to create voice session token"
- Check `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in backend `.env`
- Verify `LIVEKIT_URL` format: `wss://...`

### "Connection lost" in voice mode
- Check browser console for errors
- Verify LiveKit credentials
- Ensure backend `/api/v1/voice/token` endpoint is accessible

### Agent doesn't join room
- Verify `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- Check voice worker terminal output: should show agent connecting
- Ensure you started the voice worker (separate terminal)

### No properties appearing in voice mode
- Check `/api/v1/voice/recommendations` endpoint returns properties
- Verify property database (MongoDB) has data
- Check browser console for data channel errors

### Speech isn't being processed
- Verify `GEMINI_API_KEY` is valid
- Check browser microphone permissions
- Ensure Deepgram STT is working (via LiveKit Inference)

---

## Next Steps

1. **Get API Keys**: Complete Step 1 from Setup Instructions above
2. **Update .env files** in `server/` and `client/`
3. **Run the app** using Option A (Two Terminals) above
4. **Test**:
   - Try text chat first (existing feature)
   - Click "Voice Chat" tab
   - Click "Start Voice Session"
   - Say: "Show me 3 BHK apartments in Mumbai under 2 crore"
   - Watch properties appear in carousel!

---

## Notes

- **Voice worker process**: Must run separately from Express (can be same machine, different terminal)
- **Database**: Uses existing MongoDB connection (property listings)
- **Audio**: Browser requires secure context (HTTPS) in production; HTTP OK for localhost dev
- **Customization**: Modify agent instructions in `server/src/modules/voice/voice.agent.ts`
- **Voice**: Currently configured for Deepgram (STT) + Gemini (LLM) + ElevenLabs (TTS); easily swappable via LiveKit plugins
