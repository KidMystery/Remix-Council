/**
 * Speech Recognition and Dictation Utilities
 *
 * Prevents duplicate phrase accumulation and word-repetition loops
 * caused by Web Speech API quirks (Chrome/Android/WebKit interim-to-final
 * overlapping results and continuous recognition re-broadcasts).
 */

const ALLOWED_DOUBLETS = new Set([
  'very',
  'really',
  'no',
  'too',
  'so',
  'bye',
  'that',
  'had',
  'now',
]);

/**
 * Merge two speech segments by detecting and removing word-level overlap
 * between the end of `base` and the beginning of `addition`.
 */
export function mergeSpeechTranscripts(base: string, addition: string): string {
  const cleanBase = (base || '').trim();
  const cleanAdd = (addition || '').trim();

  if (!cleanBase) return cleanAdd;
  if (!cleanAdd) return cleanBase;

  // Case 1: Exact identical match (case-insensitive)
  if (cleanBase.toLowerCase() === cleanAdd.toLowerCase()) {
    return cleanBase;
  }

  // Case 2: Addition already contains the entire base as prefix
  if (cleanAdd.toLowerCase().startsWith(cleanBase.toLowerCase())) {
    return cleanAdd;
  }

  // Case 3: Base already ends with the addition
  if (cleanBase.toLowerCase().endsWith(cleanAdd.toLowerCase())) {
    return cleanBase;
  }

  const baseWords = cleanBase.split(/\s+/);
  const addWords = cleanAdd.split(/\s+/);

  // Check largest word overlap between end of base and start of addition
  const maxCheck = Math.min(baseWords.length, addWords.length);
  let overlapLen = 0;

  for (let k = maxCheck; k > 0; k--) {
    const baseTail = baseWords
      .slice(baseWords.length - k)
      .join(' ')
      .toLowerCase();
    const addHead = addWords.slice(0, k).join(' ').toLowerCase();
    if (baseTail === addHead) {
      overlapLen = k;
      break;
    }
  }

  if (overlapLen > 0) {
    const nonOverlapping = addWords.slice(overlapLen).join(' ');
    return nonOverlapping ? `${cleanBase} ${nonOverlapping}` : cleanBase;
  }

  return `${cleanBase} ${cleanAdd}`;
}

/**
 * Detects and removes runaway duplicate words and multi-word phrase loops
 * (e.g., "testing testing testing testing" -> "testing",
 *  "testing 1 2 testing 1 2" -> "testing 1 2").
 */
export function cleanDuplicatePhrases(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  let words = trimmed.split(/\s+/);
  if (words.length < 2) return trimmed;

  let changed = true;
  let iterations = 0;
  const maxIterations = 20; // guard against infinite loop

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Check for multi-word phrase repetitions (from largest phrase down to 1-word)
    const maxPhraseLen = Math.floor(words.length / 2);
    for (let n = maxPhraseLen; n >= 1; n--) {
      for (let i = 0; i <= words.length - 2 * n; i++) {
        const phrase1 = words.slice(i, i + n).join(' ').toLowerCase();
        const phrase2 = words.slice(i + n, i + 2 * n).join(' ').toLowerCase();

        if (phrase1 === phrase2) {
          // If 1-word and in whitelist of valid English doublets (e.g. "very very", "no no"),
          // only prune if repeated 3 or more times
          if (n === 1 && ALLOWED_DOUBLETS.has(phrase1)) {
            const hasThirdRepeat =
              i + 3 * n <= words.length &&
              words.slice(i + 2 * n, i + 3 * n).join(' ').toLowerCase() === phrase1;
            if (hasThirdRepeat) {
              words.splice(i + n, n);
              changed = true;
              break;
            }
          } else {
            // Remove duplicate phrase
            words.splice(i + n, n);
            changed = true;
            break;
          }
        }
      }
      if (changed) break;
    }
  }

  return words.join(' ');
}

/**
 * Combines existing textarea content with incoming dictation transcript,
 * deduplicating overlaps and runaway phrases.
 */
export function sanitizeDictationInput(base: string, speechChunk: string): string {
  const merged = mergeSpeechTranscripts(base, speechChunk);
  return cleanDuplicatePhrases(merged);
}
