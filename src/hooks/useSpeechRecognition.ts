import { useState, useRef, useCallback, useEffect } from 'react';
import { mergeSpeechTranscripts, cleanDuplicatePhrases } from '../lib/speechUtils';

interface RecognitionResult {
  transcript: string;
  isFinal: boolean;
}

/**
 * Browser speech-to-text (dictation) via the Web Speech API.
 * Works in Chromium-family browsers (Chrome, Edge, Brave, Arc) and modern Safari.
 */
export function useSpeechRecognition(onResult?: (r: RecognitionResult) => void) {
  const [supported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const w = window as any;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  });
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const finalTranscriptRef = useRef('');
  const silenceTimeoutRef = useRef<any>(null);
  const startRef = useRef<any>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const clearSilenceTimeout = useCallback(() => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    isListeningRef.current = false;
    finalTranscriptRef.current = '';
    clearSilenceTimeout();
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setIsListening(false);
  }, []);

  const start = useCallback((isRestart = false) => {
    if (!supported) {
      setError('Speech recognition is not supported in this browser environment.');
      return;
    }
    setError(null);
    if (!isRestart) {
      finalTranscriptRef.current = '';
    }

    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    let rec: any;
    try {
      rec = new SR();
    } catch (e: any) {
      setError(e?.message || 'Failed to initialize speech recognition');
      return;
    }
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: any) => {
      clearSilenceTimeout();
      
      let interim = '';
      const startIndex = typeof e.resultIndex === 'number' ? e.resultIndex : 0;

      for (let i = startIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const chunk = (r?.[0]?.transcript || '').trim();
        if (!chunk) continue;

        if (r.isFinal) {
          finalTranscriptRef.current = mergeSpeechTranscripts(
            finalTranscriptRef.current,
            chunk
          );
        } else {
          interim = mergeSpeechTranscripts(interim, chunk);
        }
      }

      // Merge accumulated final segments with the active interim segment
      const combined = mergeSpeechTranscripts(finalTranscriptRef.current, interim);
      const cleaned = cleanDuplicatePhrases(combined);

      if (cleaned) {
        onResultRef.current?.({
          transcript: cleaned,
          isFinal: Boolean(finalTranscriptRef.current.trim()),
        });
      }

      // Restart after 2 seconds of silence to prevent Android repetition bugs
      silenceTimeoutRef.current = setTimeout(() => {
        if (isListeningRef.current) {
          try {
            recRef.current?.stop();
          } catch {
            /* ignore */
          }
        }
      }, 2000);
    };

    rec.onerror = (e: any) => {
      clearSilenceTimeout();
      console.warn('[useSpeechRecognition] Error:', e.error);
      if (e.error === 'not-allowed') {
        setError('Microphone access was denied. Please allow microphone permissions in your browser.');
        isListeningRef.current = false;
        setIsListening(false);
      } else if (e.error === 'no-speech') {
        // Harmless silence timeout
      } else if (e.error === 'audio-capture') {
        setError('No microphone found or audio capture failed.');
        isListeningRef.current = false;
        setIsListening(false);
      } else {
        setError(`Dictation issue: ${e.error}`);
      }
    };

    rec.onend = () => {
      clearSilenceTimeout();
      // If user still intended to listen and wasn't manually stopped, restart or finish
      if (isListeningRef.current) {
        startRef.current?.(true);
      } else {
        setIsListening(false);
      }
      recRef.current = null;
    };

    recRef.current = rec;
    isListeningRef.current = true;
    setIsListening(true);

    try {
      rec.start();
    } catch (err: any) {
      console.warn('[useSpeechRecognition] start error:', err);
      setIsListening(false);
      isListeningRef.current = false;
      setError('Could not start microphone dictation.');
    }
  }, [supported, clearSilenceTimeout]);
  startRef.current = start;

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      try {
        recRef.current?.abort?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { supported, isListening, error, start, stop, toggle };
}


