import React, { useState, useEffect, useRef } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import {
  Phone,
  PhoneOff,
  AlertCircle,
} from 'lucide-react';

import type { Property } from '../types';
import { PropertyCarousel } from './PropertyCarousel';
import { useCreateVoiceTokenMutation } from '../voiceApi';

interface VoiceSessionConfig {
  roomName: string;
  identity: string;
  token: string;
  wsUrl: string;
}

interface VoiceConnectionState {
  isConnected: boolean;
  isConnecting: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  error: string | null;
  transcript: string;
}

interface VoiceModeProps {
  formatPrice: (price: number) => string;
}

const VoiceVisualizer: React.FC<{
  isActive: boolean;
  isSpeaking: boolean;
  isConnecting: boolean;
}> = ({ isActive, isSpeaking, isConnecting }) => {
  return (
    <div className="relative flex h-48 w-full items-center justify-center overflow-hidden">
      {/* Central Abstract Glow */}
      <div 
        className={`
          relative z-10 rounded-full transition-all duration-700 ease-out
          shadow-[0_0_40px_rgba(100,149,206,0.6)]
          ${isSpeaking 
            ? 'h-16 w-16 scale-125 opacity-100 animate-pulse' 
            : isConnecting
            ? 'h-12 w-12 scale-110 opacity-80 animate-pulse'
            : isActive
            ? 'h-10 w-10 scale-100 opacity-60'
            : 'h-8 w-8 scale-90 opacity-40'}
        `}
        style={{ 
          backgroundColor: isSpeaking || isConnecting || isActive ? '#6495ce' : '#cbd5e1',
        }}
      />
      
      {/* Continuously Rotating Mesh Lines */}
      {/* Layer 1 */}
      <div 
        className={`
          absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-blue-400
          transition-all duration-700 ease-out origin-center
          rounded-[40%_60%_70%_30%/40%_50%_60%_50%]
          animate-[spin_8s_linear_infinite]
          ${isSpeaking ? 'h-36 w-36 opacity-60 scale-125' : isConnecting ? 'h-32 w-32 opacity-40 scale-110' : 'h-28 w-28 opacity-20 scale-100'}
        `}
      />
      {/* Layer 2 */}
      <div 
        className={`
          absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-blue-500
          transition-all duration-1000 ease-out origin-center
          rounded-[60%_40%_30%_70%/60%_30%_70%_40%]
          animate-[spin_12s_linear_infinite_reverse]
          ${isSpeaking ? 'h-40 w-40 opacity-50 scale-125' : isConnecting ? 'h-36 w-36 opacity-30 scale-110' : 'h-32 w-32 opacity-15 scale-100'}
        `}
      />
      {/* Layer 3 */}
      <div 
        className={`
          absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-blue-300
          transition-all duration-1000 ease-out origin-center
          rounded-[30%_70%_70%_30%/30%_30%_70%_70%]
          animate-[spin_16s_linear_infinite]
          ${isSpeaking ? 'h-44 w-44 opacity-40 scale-125' : isConnecting ? 'h-40 w-40 opacity-20 scale-110' : 'h-36 w-36 opacity-10 scale-100'}
        `}
      />
    </div>
  );
};

export const VoiceMode: React.FC<VoiceModeProps> = ({
  formatPrice,
}) => {
  const [state, setState] = useState<VoiceConnectionState>({
    isConnected: false,
    isConnecting: false,
    isSpeaking: false,
    isListening: false,
    error: null,
    transcript: '',
  });

  const [voiceProperties, setVoiceProperties] = useState<Property[]>([]);
  const [seenPropertyIds, setSeenPropertyIds] = useState<Set<string>>(
    new Set(),
  );

  const roomRef = useRef<Room | null>(null);
  const sessionConfigRef = useRef<VoiceSessionConfig | null>(null);
  const remoteAudioContainerRef = useRef<HTMLDivElement | null>(null);

  const [createVoiceToken] = useCreateVoiceTokenMutation();

  const clearRemoteAudioElements = () => {
    if (remoteAudioContainerRef.current) {
      remoteAudioContainerRef.current.innerHTML = '';
    }
  };

  const connectToVoice = async () => {
    if (state.isConnecting || state.isConnected) return;

    setState((prev) => ({
      ...prev,
      isConnecting: true,
      error: null,
    }));

    try {
      try {
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
      } catch {
        throw new Error(
          'Microphone permission denied. Please enable microphone access.',
        );
      }

      const config = await createVoiceToken({
        sessionId: crypto.randomUUID(),
        identity: `web-user-${crypto.randomUUID().slice(0, 8)}`,
      }).unwrap();

      sessionConfigRef.current = config;

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      room.on(RoomEvent.Connected, async () => {
        try {
          await room.localParticipant?.setCameraEnabled(false);
          await room.localParticipant?.setMicrophoneEnabled(true);

          await room.startAudio();
        } catch (error) {
          console.error('[Voice] Failed to enable audio:', error);
        }

        setState((prev) => ({
          ...prev,
          isConnecting: false,
          isConnected: true,
          transcript: 'Connected. Start speaking naturally...',
        }));
      });

      room.on(RoomEvent.Disconnected, () => {
        clearRemoteAudioElements();

        setState((prev) => ({
          ...prev,
          isConnected: false,
          isListening: false,
          transcript: '',
        }));

        setVoiceProperties([]);
        setSeenPropertyIds(new Set());
      });

      room.on(
        RoomEvent.TrackSubscribed,
        (track) => {
          if (track.kind !== 'audio') return;

          const audioElement = track.attach();

          audioElement.autoplay = true;
          audioElement.setAttribute('playsinline', 'true');
          audioElement.controls = false;

          remoteAudioContainerRef.current?.appendChild(audioElement);
        },
      );

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== 'audio') return;

        track.detach().forEach((element) => element.remove());
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const hasRemoteSpeakers = speakers.some(
          (speaker) =>
            speaker.identity !== sessionConfigRef.current?.identity,
        );

        setState((prev) => ({
          ...prev,
          isSpeaking: hasRemoteSpeakers,
        }));
      });

      room.on(
        RoomEvent.DataReceived,
        (payload, _participant, _kind, topic) => {
          if (topic === 'property_recommendations') {
            try {
              const text = new TextDecoder().decode(payload);

              const data = JSON.parse(text);

              if (
                data.type === 'voice_properties' &&
                Array.isArray(data.properties)
              ) {
                const newProperties = data.properties.filter(
                  (prop: Property) => !seenPropertyIds.has(prop.id),
                );

                if (newProperties.length > 0) {
                  setVoiceProperties((prev) => [
                    ...prev,
                    ...newProperties,
                  ]);

                  setSeenPropertyIds((prev) => {
                    const updated = new Set(prev);

                    newProperties.forEach((prop: Property) =>
                      updated.add(prop.id),
                    );

                    return updated;
                  });
                }
              }
            } catch (error) {
              console.error(
                '[Voice] Failed to parse recommendation:',
                error,
              );
            }
          }
        },
      );

      room.on(
        RoomEvent.ConnectionStateChanged,
        (connectionState) => {
          if (connectionState === 'disconnected') {
            setState((prev) => ({
              ...prev,
              error: 'Connection lost',
            }));
          }
        },
      );

      sessionConfigRef.current = config;
      roomRef.current = room;

      await room.connect(config.wsUrl, config.token);

      await room.startAudio();
    } catch (error) {
      console.error('[Voice] Connection failed:', error);

      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to connect to voice mode',
      }));
    }
  };

  const disconnectVoice = async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };
  }, []);

  return (
    <div className="flex w-full h-full min-h-0 flex-col bg-transparent font-sans text-foreground">
      <div
        ref={remoteAudioContainerRef}
        className="hidden"
        aria-hidden="true"
      />

      {/* Error */}
      {state.error && (
        <div className="mx-4 mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4 backdrop-blur-xl">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />

          <div>
            <p className="text-sm font-medium text-red-900">
              {state.error}
            </p>
          </div>
        </div>
      )}

      {/* Connected State */}
      {state.isConnected && (
        <div className="flex flex-1 flex-col overflow-y-auto p-4 sm:p-5">
          {/* Status and End Button */}
          <div className="mb-5 flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-2">
              <div 
                className="h-2 w-2 rounded-full animate-pulse" 
                style={{ backgroundColor: '#6495ce' }}
              />

              <span className="text-xs text-slate-500">
                Voice session active
              </span>
            </div>

            <button
              onClick={disconnectVoice}
              className="
                inline-flex items-center gap-2
                rounded-full bg-red-500
                px-4 py-2 text-sm font-medium text-white
                transition-all duration-200
                hover:bg-red-600 hover:shadow-lg
                active:scale-95
              "
            >
              <PhoneOff className="h-4 w-4" />
              End
            </button>
          </div>

          {/* Transcript */}
          <div className="mb-5 shrink-0 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">
                Conversation
              </p>

              <div className="flex items-center gap-2">
                <div 
                  className="h-2 w-2 rounded-full animate-pulse" 
                  style={{ backgroundColor: '#10b981' }}
                />
                <span className="text-xs text-slate-400">
                  Live
                </span>
              </div>
            </div>

            <div
              className="
                rounded-3xl
                border border-white/40
                bg-white/70
                backdrop-blur-xl
                p-4
                shadow-[0_8px_30px_rgba(0,0,0,0.05)]
              "
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {state.transcript ||
                  'Waiting for conversation...'}
              </p>
            </div>
          </div>

          {/* Voice Visualizer with integrated tips area */}
          <div
            className="flex min-h-[250px] w-full flex-1 flex-col items-center justify-center py-6"
          >
            <VoiceVisualizer
              isActive={
                state.isConnected || state.isConnecting
              }
              isSpeaking={state.isSpeaking}
              isConnecting={state.isConnecting}
            />
            
            {/* Empty State - Blended in nicely */}
            {voiceProperties.length === 0 && (
              <div className="mt-8 text-center max-w-xs">
                <p className="text-[13px] font-medium leading-relaxed text-slate-500">
                  Tell Rahul your preferred location, budget, amenities, or apartment type and recommendations will seamlessly appear here.
                </p>
              </div>
            )}
          </div>

          {/* Recommended Properties */}
          {voiceProperties.length > 0 && (
            <div className="mt-5 shrink-0 space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  Recommended Properties
                </p>

                <span 
                  className="rounded-full px-2 py-1 text-xs font-semibold text-white"
                  style={{ backgroundColor: '#6495ce' }}
                >
                  {voiceProperties.length}
                </span>
              </div>

              <PropertyCarousel
                properties={voiceProperties}
                formatPrice={formatPrice}
              />
            </div>
          )}
        </div>
      )}

      {/* Idle State */}
      {!state.isConnected && !state.isConnecting && (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
          <div
            className="
              w-full max-w-md
              rounded-[2rem]
              border border-white/40
              bg-white/75
              p-8
              backdrop-blur-2xl
              shadow-[0_15px_45px_rgba(0,0,0,0.08)]
            "
          >
            <VoiceVisualizer
              isActive={false}
              isSpeaking={false}
              isConnecting={false}
            />

            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
              Voice Assistant
            </h2>

            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">
              Speak naturally with Rahul to discover
              properties tailored to your lifestyle,
              location, and budget preferences.
            </p>

            <button
              onClick={connectToVoice}
              className="
                mt-7 inline-flex items-center gap-2
                rounded-full
                px-6 py-3
                font-medium text-white
                transition-all duration-200
                hover:-translate-y-0.5
                hover:shadow-[0_15px_35px_rgba(100,149,206,0.35)]
                active:scale-95
              "
              style={{
                backgroundColor: '#6495ce',
                boxShadow: '0 10px 25px rgba(100, 149, 206, 0.25)'
              }}
            >
              <Phone className="h-4 w-4" />
              Start Voice Session
            </button>
          </div>
        </div>
      )}

      {/* Connecting Overlay */}
      {state.isConnecting && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-md">
          <div className="space-y-4 text-center">
            <div 
              className="mx-auto h-14 w-14 animate-spin rounded-full border-[3px] border-slate-200"
              style={{ borderTopColor: '#6495ce' }}
            />

            <div>
              <p className="text-base font-semibold text-slate-800">
                Connecting...
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Preparing voice session
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
