/**
 * Chunk payload assembly validation (v9).
 *
 * v8 finding: missions A (inventory+balances+Jul/Aug) and B (tx Jan–Mar) failed
 * empty on TWO different free models while C (tx Apr–Jun) succeeded on the same
 * payloads. Inspection of the stored A/B/C payloads showed all three are valid
 * JSON with clean UTF-8, balanced quotes, comparable chunk counts — no A/B-only
 * encoding/size anomaly. The one assembly guarantee that was NOT enforced was a
 * uniform pre-send validation: nothing checked every chunk (A, B and C alike)
 * for emptiness, control/lone-surrogate characters, or an over-cap size before
 * the chunks were inlined into deliberation prompts.
 *
 * validateChunkPayloads() is that gate. It runs on EVERY assembled chunk list
 * regardless of which mission produced it, so A/B payloads pass exactly the
 * same validation C passes — and genuinely broken payloads fail loudly with a
 * per-chunk diagnosis instead of silently producing empty model responses.
 */

/** Hard per-chunk size cap. Chunks above this cannot ride a single prompt. */
export const CHUNK_SIZE_CAP_CHARS = 120_000;

/** Control characters that must never ride inside a prompt payload. */
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** A lone UTF-16 surrogate — un-encodable JSON; providers reject or garble it. */
const LONE_SURROGATE = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/;

export interface ChunkPayloadInput {
  sourceName: string;
  index: number;
  total: number;
  content: string;
}

export type ChunkPayloadValidation =
  | { ok: true; chunks: number; totalChars: number }
  | { ok: false; error: string };

export function validateChunkPayloads(chunks: ChunkPayloadInput[]): ChunkPayloadValidation {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { ok: false, error: 'Chunk assembly produced zero chunks — nothing to deliberate over.' };
  }
  let totalChars = 0;
  for (const c of chunks) {
    const label = `${c.sourceName || 'chunk'} section ${c.index + 1}/${c.total || 1}`;
    if (typeof c.content !== 'string' || c.content.trim().length === 0) {
      return { ok: false, error: `Chunk ${label} assembled EMPTY — refusing to send a hollow payload.` };
    }
    if (c.content.length > CHUNK_SIZE_CAP_CHARS) {
      return {
        ok: false,
        error: `Chunk ${label} is ${c.content.length.toLocaleString()} chars — over the ${CHUNK_SIZE_CAP_CHARS.toLocaleString()}-char assembly cap. Rebalance the split.`,
      };
    }
    const ctrl = c.content.match(FORBIDDEN_CONTROL);
    if (ctrl) {
      return {
        ok: false,
        error: `Chunk ${label} contains forbidden control character U+${ctrl[0].codePointAt(0)!.toString(16).padStart(4, '0')} — re-render the payload.`,
      };
    }
    const lone = c.content.match(LONE_SURROGATE);
    if (lone) {
      return {
        ok: false,
        error: `Chunk ${label} contains a lone UTF-16 surrogate (U+${lone[0].codePointAt(0)!.toString(16)}) — un-encodable JSON; re-render the payload.`,
      };
    }
    totalChars += c.content.length;
  }
  return { ok: true, chunks: chunks.length, totalChars };
}
