/**
 * Oracle voice rotation — a roster of distinct analytical "personalities" the
 * autonomous assistant cycles through so each turn brings a different voice,
 * while staying on the user's chosen model (budget-safe by default).
 */

export interface OracleVoice {
  id: string;
  name: string;
  avatar: string;
  prompt: string;
  /**
   * Optional budget-tier model used when "Model per voice" rotation is enabled.
   * All suggestions are cheap/balanced tier — they never exceed the cost class
   * of a user who already selected a paid model, and are skipped entirely for
   * free-tier models.
   */
  model?: string;
}

export const ORACLE_VOICES: OracleVoice[] = [
  {
    id: 'skeptic',
    name: 'The Skeptic',
    avatar: '🛡️',
    prompt:
      'Adopt the Skeptic voice: stress-test the idea, hunt for hidden flaws, edge-case failure modes, and unwarranted assumptions. Be direct and precise.',
    model: 'deepseek/deepseek-chat',
  },
  {
    id: 'visionary',
    name: 'The Visionary',
    avatar: '🔮',
    prompt:
      'Adopt the Visionary voice: think 5–10 years out, surface non-obvious possibilities and transformative potential. Challenge status-quo limits.',
    model: 'google/gemini-2.5-flash',
  },
  {
    id: 'pragmatist',
    name: 'The Pragmatist',
    avatar: '⚡',
    prompt:
      'Adopt the Pragmatist voice: focus on what is feasible now, architectural simplicity, and step-by-step execution. Reject over-engineering.',
    model: 'openai/gpt-4o-mini',
  },
  {
    id: 'synthesist',
    name: 'The Synthesist',
    avatar: '⚖️',
    prompt:
      'Adopt the Synthesist voice: reconcile conflicting perspectives into one clear, balanced, decisive answer with explicit trade-offs.',
    model: 'google/gemini-2.5-flash',
  },
  {
    id: 'strategist',
    name: 'The Strategist',
    avatar: '♟️',
    prompt:
      'Adopt the Strategist voice: think in systems and second-order effects. Identify leverage points and long-run consequences.',
    model: 'openai/gpt-4o',
  },
  {
    id: 'teacher',
    name: 'The Teacher',
    avatar: '📘',
    prompt:
      'Adopt the Teacher voice: explain clearly from first principles, build intuition, and confirm understanding without condescension.',
    model: 'meta-llama/llama-3.3-70b-instruct',
  },
];

export function pickVoice(turnIndex: number): OracleVoice {
  return ORACLE_VOICES[turnIndex % ORACLE_VOICES.length];
}

export interface VoiceModelResolution {
  model: string;
  /** Set only when a substitution happened, so the UI can surface it. */
  note?: string;
}

/**
 * Picks the model for a voiced turn, validating the voice's hardcoded model
 * against the live catalog when one is available.
 *
 * Why this exists (Aug 2026 incident): voice models used to be sent raw.
 * When one delisted on OpenRouter (gpt-4o, llama-3.3-70b…), every turn that
 * voice came up returned a provider 404 — and because the rotation pointer
 * only advanced on success, retries re-picked the SAME dead model. Result:
 * an error storm that never self-healed.
 *
 * Rules:
 * - No voice / model-per-voice off / free-tier thread / voice has no model
 *   → the thread's own model (never upscale a free thread).
 * - Catalog available and the voice model is live → the voice model.
 * - Catalog available and the voice model is DELISTED → the thread's model,
 *   plus a visible note naming the swap. No more silent 404 loop.
 * - Catalog unavailable (offline) → legacy behavior: trust the voice model.
 */
export function resolveVoiceModel(
  voice: OracleVoice | null | undefined,
  opts: {
    threadModel: string;
    modelPerVoice: boolean;
    threadModelIsFree: boolean;
    /** Liveness check from the live catalog. Omit when no catalog is loaded. */
    isLive?: (id: string) => boolean;
  }
): VoiceModelResolution {
  const threadModel = opts.threadModel;
  const wanted = voice && opts.modelPerVoice && !opts.threadModelIsFree && voice.model;
  if (!voice || !wanted) return { model: threadModel };

  const voiceModel = voice.model as string;
  if (!opts.isLive) return { model: voiceModel };
  if (opts.isLive(voiceModel)) return { model: voiceModel };

  const shortVoice = voiceModel.split('/').pop() || voiceModel;
  const shortThread = threadModel.split('/').pop() || threadModel;
  return {
    model: threadModel,
    note: `${voice.name}'s model ${shortVoice} is delisted — replying on ${shortThread} this turn.`,
  };
}
