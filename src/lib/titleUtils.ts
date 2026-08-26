const STORY_OPENER = /^(anyway|okay so|ok so|okay|ok|well|so|like|um|uh)\s+/i;
const ASK_WRAPPER =
  /^(can you|please|could you|what is|what are|how to|how do i|how should we|explain|analyze|deliberate on|give me|i need to|i need a|tell me about|help me with|help me|i want to)\s+/i;

const ASK_HINT = /\?|\b(help|fix|plan|need|should|figure out|what do i|how do i)\b/i;

function stripFiller(text: string): string {
  let phrase = text.trim();
  for (let i = 0; i < 4; i++) {
    const next = phrase.replace(STORY_OPENER, '').trim();
    if (next === phrase) break;
    phrase = next;
  }
  return phrase.replace(ASK_WRAPPER, '').trim();
}

function lastAsk(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return text;
  const hinted = [...sentences].reverse().find((s) => ASK_HINT.test(s));
  return hinted || sentences[sentences.length - 1];
}

/**
 * Sidebar label from a first message. Short asks keep their wording.
 * Long rants use the last ask (people put the point at the end), not the
 * first five words of the story.
 */
export function summarizeTitle(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) return 'New Deliberation';

  let clean = text.replace(/\[Attached File:[^\]]+\]/g, '').trim();
  clean = clean.replace(/--- Attached File:[^\n]+\n/g, '').trim();
  clean = clean.replace(/\s+/g, ' ');

  const wordsIn = clean.split(' ').filter(Boolean);
  const source = wordsIn.length > 40 || clean.length > 180 ? lastAsk(clean) : clean;
  let phrase = stripFiller(source).replace(/[?.!]+$/g, '').trim();
  if (!phrase) phrase = stripFiller(clean).replace(/[?.!]+$/g, '').trim() || clean;

  const words = phrase.split(' ').filter(Boolean);
  if (words.length > 8) {
    phrase = words.slice(0, 8).join(' ');
  }
  if (phrase.length > 42) {
    phrase = phrase.slice(0, 40).trimEnd() + '...';
  } else if (words.length > 8) {
    phrase += '...';
  }

  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
