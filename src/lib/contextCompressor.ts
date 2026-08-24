import type { CouncilRound } from '../types';
import { streamOpenRouter } from './openrouter';

/**
 * Default compression model: a cheap, fast, live workhorse. (The previous
 * default, gemini-2.0-flash-exp:free, was delisted from OpenRouter and would
 * have failed every context-compression call.)
 */
export async function compressSessionContext(
  rounds: CouncilRound[],
  compressionModel: string = 'google/gemini-2.5-flash'
): Promise<string> {
  if (rounds.length <= 1) return '';

  // Take all rounds except the most recent active one
  const priorRounds = rounds.slice(0, -1);
  const contextCorpus = priorRounds
    .map((r, i) => {
      const s3 = r.deliberation?.stage3?.content || 'No final synthesis recorded.';
      return `[Round ${i + 1} Question]: ${r.userQuery}\n[Round ${i + 1} Consensus]: ${s3}`;
    })
    .join('\n\n---\n\n');

  const prompt = `You are the Council Memory Archivist. Synthesize a dense, highly structured context summary of all preceding deliberation rounds.
Retain core architectural verdicts, active constraints, critical trade-offs, and agreed-upon invariants. Eliminate fluff.

Deliberation History:
${contextCorpus}`;

  try {
    const res = await streamOpenRouter({
      model: compressionModel,
      messages: [
        { role: 'system', content: 'You are the Council Archivist specializing in lossless semantic compression.' },
        { role: 'user', content: prompt },
      ],
      budget: 'free',
      maxTokens: 1000,
    });
    return res.content;
  } catch (err) {
    console.warn('[ContextCompressor] Context compression failed; falling back to raw history excerpt:', err);
    return priorRounds
      .map((r, i) => `Round ${i + 1}: ${r.userQuery} -> ${r.deliberation?.stage3?.content?.slice(0, 150) || ''}...`)
      .join('\n');
  }
}
