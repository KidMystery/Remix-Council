import { useState, useRef, useCallback, useEffect } from 'react';

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
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const stop = useCallback(() => {
    isListeningRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setError('Speech recognition is not supported in this browser environment.');
      return;
    }
    setError(null);

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
      let final = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      const full = (final + interim).trim();
      if (full) {
        onResultRef.current?.({ transcript: full, isFinal: Boolean(final.trim()) });
      }
    };

    rec.onerror = (e: any) => {
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
      // If user still intended to listen and wasn't manually stopped, finish gracefully
      if (isListeningRef.current) {
        setIsListening(false);
        isListeningRef.current = false;
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
  }, [supported]);

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

