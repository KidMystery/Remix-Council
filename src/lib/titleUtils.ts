export function summarizeTitle(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) return 'New Deliberation';

  // Strip attached file markers
  let clean = text.replace(/\[Attached File:[^\]]+\]/g, '').trim();
  clean = clean.replace(/--- Attached File:[^\n]+\n/g, '').trim();

  // Clean extra whitespace
  clean = clean.replace(/\s+/g, ' ');

  // Strip common conversational filler prefixes
  const prefixRegex = /^(can you|please|could you|what is|what are|how to|how do i|how should we|explain|analyze|deliberate on|give me|i need to|tell me about|help me with|i want to)\s+/i;
  let phrase = clean.replace(prefixRegex, '');

  // Remove trailing question marks or punctuation
  phrase = phrase.replace(/[?.!]+$/, '').trim();

  if (!phrase) phrase = clean;

  // Split into words and limit length
  const words = phrase.split(' ');
  if (words.length > 5) {
    phrase = words.slice(0, 5).join(' ') + '...';
  } else if (phrase.length > 32) {
    phrase = phrase.slice(0, 30) + '...';
  }

  // Capitalize first letter
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
