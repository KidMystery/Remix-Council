import type { AttachedTextFile } from '../types';
import type { ExecutionPolicy } from './executionPolicy';
import { streamOpenRouterCompletion } from './openrouter';

const CHUNK_SIZE = 25_000;
const CHUNK_OVERLAP = 500;

const SUMMARIZER_SYSTEM_PROMPT =
  'You are a precise data summarizer. Preserve all numbers, names, dates, amounts, percentages, and specific values exactly as they appear. Do not interpret or editorialize.';

export interface ChunkProcessorOptions {
  model: string;
  policy: ExecutionPolicy;
  apiKey: string;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
}

/**
 * Preprocesses a large attached file by summarizing it in overlapping chunks.
 * Returns the original content unchanged when it is within the size limit.
 */
export async function preprocessLargeAttachment(
  file: AttachedTextFile,
  options: ChunkProcessorOptions
): Promise<string> {
  const content = file.content || '';

  if (content.length <= 50_000) {
    return content;
  }

  // Split into overlapping chunks
  const chunks: string[] = [];
  let i = 0;
  while (i < content.length) {
    chunks.push(content.slice(i, i + CHUNK_SIZE));
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  const summaries: string[] = [];
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const res = await streamOpenRouterCompletion({
      model: options.model,
      messages: [
        { role: 'system', content: SUMMARIZER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Summarize the key facts and data in this section:\n\n${chunk}`,
        },
      ],
      maxTokens: 800,
      signal: options.signal,
    });

    summaries.push(res.content || '');
    options.onProgress?.(chunkIndex + 1, chunks.length);
  }

  return summaries
    .map((s, idx) => `--- Section ${idx + 1} of ${chunks.length} ---\n${s}`)
    .join('\n\n');
}
