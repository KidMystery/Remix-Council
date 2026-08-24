import { useState, useCallback, useEffect, useRef } from 'react';

export type GeminiVoiceName = 'Kore' | 'Puck' | 'Zephyr' | 'Fenrir' | 'Charon';

export interface VoiceOption {
  id: GeminiVoiceName;
  name: string;
  description: string;
  tone: string;
}

export const GOOGLE_AI_VOICES: VoiceOption[] = [
  { id: 'Kore', name: 'Kore', description: 'Warm, balanced, natural studio narrator', tone: 'Warm & Studio-grade' },
  { id: 'Puck', name: 'Puck', description: 'Enthusiastic, energetic, conversational', tone: 'Energetic & Lively' },
  { id: 'Zephyr', name: 'Zephyr', description: 'Calm, gentle, soothing tone', tone: 'Calm & Serene' },
  { id: 'Fenrir', name: 'Fenrir', description: 'Crisp, articulate, clear clarity', tone: 'Crisp & Articulate' },
  { id: 'Charon', name: 'Charon', description: 'Deep, resonant, authoritative', tone: 'Deep & Authoritative' },
];

const PREFERRED_VOICE_KEY = 'preferred_oracle_gemini_voice';

// In-memory audio cache for zero-latency instant replays
const audioCache = new Map<string, string>();

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function cleanTextForSpeech(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' Code snippet omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[\^?\d+\]/g, '') // strip citation marks like [1], [^2]
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [title](url) -> title
    .replace(/https?:\/\/\S+/g, '') // remove urls
    .replace(/^[#*>\-\s]+/gm, '') // remove leading markdown characters
    .replace(/[*_~`]/g, '') // remove markdown inline styling
    .replace(/\s+/g, ' ')
    .trim();
}

export function useSpeech() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [voice, setVoiceState] = useState<GeminiVoiceName>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(PREFERRED_VOICE_KEY) as GeminiVoiceName;
      if (saved && GOOGLE_AI_VOICES.some((v) => v.id === saved)) {
        return saved;
      }
    }
    return 'Kore';
  });

  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const speakingIdRef = useRef<string | null>(null);
  speakingIdRef.current = speakingId;

  const setVoice = useCallback((newVoice: GeminiVoiceName) => {
    setVoiceState(newVoice);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(PREFERRED_VOICE_KEY, newVoice);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const stop = useCallback(() => {
    // 1. Abort any in-flight Google TTS generation
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }

    // 2. Pause and tear down active HTML5 audio playback
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
        activeAudioRef.current.src = '';
      } catch {
        /* ignore */
      }
      activeAudioRef.current = null;
    }

    // 3. Cancel any browser Web Speech Synthesis fallback
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }

    setSpeakingId(null);
    setLoadingId(null);
  }, []);

  // Browser Web Speech fallback if offline or server TTS is unavailable
  const fallbackToWebSpeech = useCallback((text: string, id: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSpeakingId(null);
      setLoadingId(null);
      return;
    }

    const synth = window.speechSynthesis;
    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 1000));
      utterance.lang = 'en-US';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      const voices = synth.getVoices();
      if (voices && voices.length > 0) {
        const chosen =
          voices.find((v) => (v.lang === 'en-US' || v.lang === 'en_US') && v.default) ||
          voices.find((v) => v.lang.startsWith('en')) ||
          voices[0];
        if (chosen) utterance.voice = chosen;
      }

      utterance.onend = () => setSpeakingId(null);
      utterance.onerror = () => setSpeakingId(null);

      setSpeakingId(id);
      setLoadingId(null);
      synth.speak(utterance);
    } catch {
      setSpeakingId(null);
      setLoadingId(null);
    }
  }, []);

  const speak = useCallback(
    async (rawText: string, id: string, voiceOverride?: GeminiVoiceName) => {
      const selectedVoice = voiceOverride || voice;

      // Toggle off if currently speaking or generating for this exact card/message
      if (speakingIdRef.current === id) {
        stop();
        return;
      }

      // Stop any other active speech
      stop();

      const cleanText = cleanTextForSpeech(rawText);
      if (!cleanText) return;

      const cacheKey = `${selectedVoice}:${hashString(cleanText)}`;

      // 1. Check instant in-memory cache
      const cachedAudio = audioCache.get(cacheKey);
      if (cachedAudio) {
        try {
          const audio = new Audio(cachedAudio);
          activeAudioRef.current = audio;
          audio.onended = () => {
            setSpeakingId(null);
            activeAudioRef.current = null;
          };
          audio.onerror = () => {
            fallbackToWebSpeech(cleanText, id);
          };

          setSpeakingId(id);
          setLoadingId(null);
          await audio.play();
          return;
        } catch (e) {
          console.warn('[useSpeech] Cached audio play failed, re-fetching...', e);
        }
      }

      // 2. Fetch high-fidelity Google Neural TTS from backend
      setLoadingId(id);
      const abortCtrl = new AbortController();
      abortCtrlRef.current = abortCtrl;

      try {
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            voice: selectedVoice,
          }),
          signal: abortCtrl.signal,
        });

        if (!response.ok) {
          throw new Error(`TTS server responded with ${response.status}`);
        }

        const data = await response.json();
        if (!data.audio) {
          throw new Error('No audio returned from TTS server');
        }

        // Cache the WAV audio for zero-latency replays
        audioCache.set(cacheKey, data.audio);

        // If user didn't cancel during the brief network roundtrip
        if (!abortCtrl.signal.aborted) {
          const audio = new Audio(data.audio);
          activeAudioRef.current = audio;
          audio.onended = () => {
            setSpeakingId(null);
            activeAudioRef.current = null;
          };
          audio.onerror = () => {
            fallbackToWebSpeech(cleanText, id);
          };

          setSpeakingId(id);
          setLoadingId(null);
          await audio.play();
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.warn('[useSpeech] Google TTS request failed, using system speech fallback:', err);
        fallbackToWebSpeech(cleanText, id);
      } finally {
        if (abortCtrlRef.current === abortCtrl) {
          abortCtrlRef.current = null;
        }
      }
    },
    [voice, stop, fallbackToWebSpeech]
  );

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    speak,
    stop,
    speakingId,
    loadingId,
    isLoading: Boolean(loadingId),
    voice,
    setVoice,
    availableVoices: GOOGLE_AI_VOICES,
  };
}

