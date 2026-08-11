import { useState, useCallback, useEffect, useRef } from 'react';

// Prevent V8 Garbage Collection of SpeechSynthesisUtterance objects
declare global {
  interface Window {
    _speechUtterances?: SpeechSynthesisUtterance[];
  }
}

/**
 * Splits long text into natural sentence chunks (< 150 characters)
 * to bypass Chromium/WebKit limits that cause speech to cut off after ~15 seconds / 2 words.
 */
function splitTextIntoChunks(text: string, maxChunkLen = 140): string[] {
  if (!text) return [];

  // Match sentence endings or newlines
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if ((currentChunk + ' ' + trimmed).length <= maxChunkLen) {
      currentChunk = currentChunk ? `${currentChunk} ${trimmed}` : trimmed;
    } else {
      if (currentChunk) chunks.push(currentChunk);

      // If a single sentence exceeds maxChunkLen, split by space
      if (trimmed.length > maxChunkLen) {
        const words = trimmed.split(/\s+/);
        let wordChunk = '';
        for (const word of words) {
          if ((wordChunk + ' ' + word).length <= maxChunkLen) {
            wordChunk = wordChunk ? `${wordChunk} ${word}` : word;
          } else {
            if (wordChunk) chunks.push(wordChunk);
            wordChunk = word;
          }
        }
        currentChunk = wordChunk;
      } else {
        currentChunk = trimmed;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0 ? chunks : [text];
}

export function useSpeech() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const speakingIdRef = useRef<string | null>(null);
  const timerRef = useRef<any>(null);

  // Queue references for chunked speech playback
  const chunksRef = useRef<string[]>([]);
  const chunkIndexRef = useRef<number>(0);
  const isCancelledRef = useRef<boolean>(false);

  useEffect(() => {
    speakingIdRef.current = speakingId;
  }, [speakingId]);

  const clearResumeTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    isCancelledRef.current = true;
    clearResumeTimer();

    if (typeof window !== 'undefined') {
      window._speechUtterances = [];
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }

    chunksRef.current = [];
    chunkIndexRef.current = 0;
    setSpeakingId(null);
  }, [clearResumeTimer]);

  const speak = useCallback((text: string, id: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      alert('Text-to-speech is not supported in this browser environment.');
      return;
    }

    const synth = window.speechSynthesis;

    // Toggle off if currently speaking this exact item
    if (speakingIdRef.current === id) {
      stop();
      return;
    }

    // Stop active speech and reset queue state
    stop();

    // Clean markdown symbols & formatting for natural speech
    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[#*_\-\/>~=+|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return;

    // Break text into ~140 character chunks to avoid Chromium cutoff bug
    const chunks = splitTextIntoChunks(cleanText, 140);
    chunksRef.current = chunks;
    chunkIndexRef.current = 0;
    isCancelledRef.current = false;

    // Small delay after cancel() to ensure browser speech engine flushes
    setTimeout(() => {
      if (isCancelledRef.current) return;

      if (!window._speechUtterances) {
        window._speechUtterances = [];
      } else {
        window._speechUtterances = [];
      }

      setSpeakingId(id);

      const playNextChunk = () => {
        if (
          isCancelledRef.current ||
          chunkIndexRef.current >= chunksRef.current.length
        ) {
          clearResumeTimer();
          window._speechUtterances = [];
          setSpeakingId(null);
          return;
        }

        const chunk = chunksRef.current[chunkIndexRef.current];
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Retain utterance reference in window array to prevent garbage collection
        window._speechUtterances?.push(utterance);

        const voices = synth.getVoices();
        if (voices.length > 0) {
          const chosen =
            voices.find((v) => v.lang.startsWith('en') && v.default) ||
            voices.find((v) => v.lang.startsWith('en')) ||
            voices[0];
          if (chosen) utterance.voice = chosen;
        }

        utterance.onend = () => {
          if (!isCancelledRef.current) {
            chunkIndexRef.current += 1;
            playNextChunk();
          }
        };

        utterance.onerror = (err) => {
          console.warn('Speech chunk error:', err);
          if (!isCancelledRef.current) {
            chunkIndexRef.current += 1;
            playNextChunk();
          }
        };

        try {
          if (synth.paused) {
            synth.resume();
          }
          synth.speak(utterance);
        } catch (e) {
          console.error('Speech synthesis speak error:', e);
          chunkIndexRef.current += 1;
          playNextChunk();
        }
      };

      // Start playing first chunk
      playNextChunk();

      // Chrome heartbeat timer: period resume() keeps long playback active without pausing
      clearResumeTimer();
      timerRef.current = setInterval(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          if (window.speechSynthesis.speaking) {
            window.speechSynthesis.resume();
          } else if (!window.speechSynthesis.pending) {
            clearResumeTimer();
          }
        }
      }, 3000);
    }, 100);
  }, [stop, clearResumeTimer]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }

    return () => {
      stop();
    };
  }, [stop]);

  return { speak, stop, speakingId };
}
