import React, { useState, useEffect, useRef } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import {
  Phone,
  PhoneOff,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

import type { Property } from '../types';
import { PropertyCarousel } from './PropertyCarousel';
import { useCreateVoiceTokenMutation } from '../voiceApi';
import { generateUUID } from '../../../utils/uuid';
import { usePreferences } from '../PreferencesContext';

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

interface BookingInfo {
  propertyName: string;
  date: string;
  timeSlot: string;
  bookingId: string;
  userName?: string;
  userPhone?: string;
  status: 'Confirmed' | 'Pending';
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
  const { updateFromVoice, sessionId } = usePreferences();
  const [state, setState] = useState<VoiceConnectionState>({
    isConnected: false,
    isConnecting: false,
    isSpeaking: false,
    isListening: false,
    error: null,
    transcript: '',
  });

  const [voiceProperties, setVoiceProperties] = useState<Property[]>(() => {
    const saved = sessionStorage.getItem('voiceProperties');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [seenPropertyIds, setSeenPropertyIds] = useState<Set<string>>(() => {
    const saved = sessionStorage.getItem('seenPropertyIds');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  const [voiceBookings, setVoiceBookings] = useState<BookingInfo[]>(() => {
    const saved = sessionStorage.getItem('voiceBookings');
    return saved ? JSON.parse(saved) : [];
  });

  // Save to session storage whenever they change
  useEffect(() => {
    sessionStorage.setItem('voiceProperties', JSON.stringify(voiceProperties));
    sessionStorage.setItem('seenPropertyIds', JSON.stringify(Array.from(seenPropertyIds)));
    sessionStorage.setItem('voiceBookings', JSON.stringify(voiceBookings));
  }, [voiceProperties, seenPropertyIds, voiceBookings]);

  const roomRef = useRef<Room | null>(null);
  const sessionConfigRef = useRef<VoiceSessionConfig | null>(null);
  const remoteAudioContainerRef = useRef<HTMLDivElement | null>(null);

  const [createVoiceToken] = useCreateVoiceTokenMutation();
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    return localStorage.getItem('voiceSelectedLanguage') || 'Hinglish';
  });

  useEffect(() => {
    localStorage.setItem('voiceSelectedLanguage', selectedLanguage);
  }, [selectedLanguage]);

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

      const identity = `web-user-${generateUUID().slice(0, 8)}`;

      const config = await createVoiceToken({
        sessionId,
        identity,
        language: selectedLanguage,
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
      });

      room.on(
        RoomEvent.TrackSubscribed,
        (track) => {
          console.log('[Voice] TrackSubscribed event received for track SID:', track.sid, 'kind:', track.kind);
          if (track.kind !== 'audio') return;

          const audioElement = track.attach();
          console.log('[Voice] Audio track attached to element. Autoplay set to true.');

          audioElement.autoplay = true;
          audioElement.setAttribute('playsinline', 'true');
          audioElement.controls = false;

          if (remoteAudioContainerRef.current) {
            // Remove any existing children to prevent overlapping duplicates
            remoteAudioContainerRef.current.innerHTML = '';
            remoteAudioContainerRef.current.appendChild(audioElement);
            console.log('[Voice] Attached audio element to the DOM container.');
          }

          // Force playback and register handlers for autoplay policies
          audioElement.play()
            .then(() => {
              console.log('[Voice] Audio playback successfully started.');
            })
            .catch((err) => {
              console.warn('[Voice] Playback failed or autoplay blocked by browser:', err);
              console.log('[Voice] Attempting fallback: room.startAudio() to unlock audio context.');
              // Force LiveKit to resume the AudioContext via room.startAudio()
              room.startAudio()
                .then(() => console.log('[Voice] room.startAudio() completed successfully.'))
                .catch((roomErr) => console.error('[Voice] room.startAudio() fallback failed:', roomErr));
            });
        },
      );

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        console.log('[Voice] TrackUnsubscribed event for track SID:', track.sid);
        if (track.kind !== 'audio') return;

        track.detach().forEach((element) => {
          console.log('[Voice] Detached and removing audio element from DOM');
          element.remove();
        });
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
              } else if (data.type === 'voice_booking' && data.booking) {
                setVoiceBookings((prev) => {
                  if (prev.some(b => b.bookingId === data.booking.bookingId)) return prev;
                  return [...prev, data.booking];
                });
              } else if (data.type === 'voice_preference_update' && data.preferences) {
                updateFromVoice(data.preferences.shortlistedProperties, data.preferences.notInterestedProperties);
              }
            } catch (error) {
              console.error(
                '[Voice] Failed to parse recommendation/preference:',
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
    disconnectVoice();
    setVoiceProperties([]);
    setSeenPropertyIds(new Set());
    setVoiceBookings([]);
    sessionStorage.removeItem('voiceProperties');
    sessionStorage.removeItem('seenPropertyIds');
    sessionStorage.removeItem('voiceBookings');
    setState({
      isConnected: false,
      isConnecting: false,
      isSpeaking: false,
      isListening: false,
      error: null,
      transcript: '',
    });
  }, [sessionId]);

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
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: '0',
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: '0',
        }}
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
        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col overflow-y-auto px-5 py-4">
          {/* Status and End Button - Ultra compact */}
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-1">
              <div 
                className="h-1.5 w-1.5 rounded-full animate-pulse" 
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
                px-3 py-1.5 text-xs font-medium text-white
                transition-all duration-200
                hover:bg-red-600 hover:shadow-lg
                active:scale-95
              "
            >
              <PhoneOff className="h-3 w-3" />
              End
            </button>
          </div>

          {/* Compact Visualizer - Always show when connected */}
          <div className="flex w-full justify-center py-2">
            <div style={{ width: '100%', transformOrigin: 'center' }}>
              <VoiceVisualizer
                isActive={true}
                isSpeaking={state.isSpeaking}
                isConnecting={false}
              />
            </div>
          </div>

          {/* Recommended Properties */}
          {voiceProperties.length > 0 && (
            <div className="mt-1 shrink-0 space-y-3">
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

          {/* Scheduled Visits */}
          {voiceBookings.length > 0 && (
            <div className="mt-4 shrink-0 space-y-3 text-left">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  Scheduled Visits
                </p>
                <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-white">
                  {voiceBookings.length}
                </span>
              </div>
              <div className="space-y-3">
                {voiceBookings.map((booking) => (
                  <div key={booking.bookingId} className="flex flex-col rounded-[1.5rem] border border-emerald-100 bg-emerald-50/45 p-4 shadow-sm backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-emerald-100/60">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span className="text-sm font-semibold text-slate-900 truncate max-w-[150px]">{booking.propertyName}</span>
                      </div>
                      <span className="rounded-full bg-emerald-200/60 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                        {booking.status}
                      </span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                      <div>
                        <span className="font-semibold text-slate-400 block mb-0.5 tracking-wider uppercase text-[9px]">DATE</span>
                        <span className="text-slate-800 font-semibold">{booking.date}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-400 block mb-0.5 tracking-wider uppercase text-[9px]">TIME SLOT</span>
                        <span className="text-slate-800 font-semibold">{booking.timeSlot}</span>
                      </div>
                      <div className="col-span-2 border-t border-emerald-100/50 pt-2.5 mt-1 flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-400 tracking-wider uppercase text-[9px]">VISITOR</span>
                          <span className="text-slate-800 font-bold">{booking.userName}</span>
                        </div>
                        <span className="font-mono text-[10px] text-emerald-700 font-bold bg-emerald-100/70 px-2 py-0.5 rounded shadow-sm">
                          ID: {booking.bookingId}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Idle State / Connecting State (when not connected) */}
      {!state.isConnected && (
        <div className="flex flex-1 flex-col relative">
          {voiceProperties.length > 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 w-full py-6 px-5">
              <div className="w-full flex justify-center mb-2">
                <VoiceVisualizer
                  isActive={false}
                  isSpeaking={false}
                  isConnecting={state.isConnecting}
                />
              </div>

              {state.isConnecting ? (
                <div className="flex flex-col items-center mt-2">
                  <div 
                    className="mx-auto h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200"
                    style={{ borderTopColor: '#6495ce' }}
                  />
                  <p className="mt-3 text-xs font-medium text-slate-600">Connecting to voice...</p>
                </div>
              ) : (
                <>
                  <div className="mt-2 mb-4 flex flex-col items-center w-full text-center gap-1.5 max-w-xs">
                    <label htmlFor="voice-lang-select-continue" className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      Language
                    </label>
                    <select
                      id="voice-lang-select-continue"
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value)}
                      disabled={state.isConnecting}
                      className="
                        w-full max-w-[200px] rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-700
                        shadow-sm outline-none transition-all duration-200 hover:border-slate-300 focus:border-blue-400
                        disabled:opacity-60 disabled:cursor-not-allowed text-center
                      "
                    >
                      <option value="Hinglish">Hindi (Hinglish)</option>
                      <option value="English">English</option>
                      <option value="Marathi">Marathi (मराठी)</option>
                    </select>
                  </div>
                  <button
                    onClick={connectToVoice}
                    className="
                      inline-flex items-center gap-2
                      rounded-full
                      px-4 py-2
                      font-medium text-white text-sm
                      transition-all duration-200
                      active:scale-95
                    "
                    style={{
                      backgroundColor: '#6495ce',
                      boxShadow: '0 15px 30px rgba(100, 149, 206, 0.3)'
                    }}
                  >
                    Continue
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full px-4 min-h-[300px]">
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
                  isConnecting={state.isConnecting}
                />

                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
                  Voice Assistant
                </h2>

                <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">
                  Speak naturally with Shriya to discover
                  properties tailored to your lifestyle,
                  location, and budget preferences.
                </p>

                <div className="mt-5 flex flex-col items-center w-full text-center gap-1.5">
                  <label htmlFor="voice-lang-select" className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Select Language
                  </label>
                  <select
                    id="voice-lang-select"
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                    disabled={state.isConnecting}
                    className="
                      w-full max-w-[240px] rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-700
                      shadow-sm outline-none transition-all duration-200 hover:border-slate-300 focus:border-blue-400
                      disabled:opacity-60 disabled:cursor-not-allowed text-center
                    "
                  >
                    <option value="Hinglish">Hindi (Hinglish)</option>
                    <option value="English">English</option>
                    <option value="Marathi">Marathi (मराठी)</option>
                  </select>
                </div>
 
                <button
                  onClick={connectToVoice}
                  disabled={state.isConnecting}
                  className={`
                    mt-7 inline-flex items-center gap-2
                    rounded-full
                    px-6 py-3
                    font-medium text-white
                    transition-all duration-200
                    hover:-translate-y-0.5
                    hover:shadow-[0_15px_35px_rgba(100,149,206,0.35)]
                    active:scale-95
                    ${state.isConnecting ? 'opacity-80 cursor-not-allowed' : ''}
                  `}
                  style={{
                    backgroundColor: '#6495ce',
                    boxShadow: '0 10px 25px rgba(100, 149, 206, 0.25)'
                  }}
                >
                  {state.isConnecting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Phone className="h-4 w-4" />
                      Start Voice Session
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Recommended Properties History */}
          {voiceProperties.length > 0 && (
            <div className="mt-2 px-4 mx-auto w-full max-w-md shrink-0 space-y-3 text-left">
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

          {/* Scheduled Visits History */}
          {voiceBookings.length > 0 && (
            <div className="mt-4 px-4 mx-auto w-full max-w-md shrink-0 space-y-3 text-left">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  Scheduled Visits
                </p>
                <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-white">
                  {voiceBookings.length}
                </span>
              </div>
              <div className="space-y-3">
                {voiceBookings.map((booking) => (
                  <div key={booking.bookingId} className="flex flex-col rounded-[1.5rem] border border-emerald-100 bg-emerald-50/45 p-4 shadow-sm backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-emerald-100/60">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span className="text-sm font-semibold text-slate-900 truncate max-w-[150px]">{booking.propertyName}</span>
                      </div>
                      <span className="rounded-full bg-emerald-200/60 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                        {booking.status}
                      </span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                      <div>
                        <span className="font-semibold text-slate-400 block mb-0.5 tracking-wider uppercase text-[9px]">DATE</span>
                        <span className="text-slate-800 font-semibold">{booking.date}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-400 block mb-0.5 tracking-wider uppercase text-[9px]">TIME SLOT</span>
                        <span className="text-slate-800 font-semibold">{booking.timeSlot}</span>
                      </div>
                      <div className="col-span-2 border-t border-emerald-100/50 pt-2.5 mt-1 flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-400 tracking-wider uppercase text-[9px]">VISITOR</span>
                          <span className="text-slate-800 font-bold">{booking.userName}</span>
                        </div>
                        <span className="font-mono text-[10px] text-emerald-700 font-bold bg-emerald-100/70 px-2 py-0.5 rounded shadow-sm">
                          ID: {booking.bookingId}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
