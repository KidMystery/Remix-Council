/**
 * Regression guards for the Chamber session/preset flows the owner hit:
 *
 * 1. A blank "New Deliberation" must never be auto-created while the session
 *    manager is still loading local/Drive storage (it merged into the synced
 *    thread set on every unsigned visit).
 *
 * 2. Hand-picked models win: a free-tier preset whose roster contains a
 *    non-free model leaves free mode EXPLICITLY instead of erroring
 *    mid-deliberation. "Free mode never upgrades to paid silently" is kept:
 *    this is a visible preset change, not an in-mode upgrade.
 */

import { isFreeModelId } from './executionPolicy';

/** Preset ids whose policy is the strict zero-cost budget. */
export const FREE_TIER_PRESET_IDS = new Set(['fast_and_free', 'fastest_cheapest']);
/** The paid preset free mode steps aside to when hand-picked models aren't free. */
export const PAID_FALLBACK_PRESET_ID = 'balanced_quality';

export function shouldAutoCreateInitialSession(opts: {
  isLoading: boolean;
  sessionCount: number;
  hasActiveSessionId: boolean;
}): boolean {
  // Never while storage/Drive load is in flight — that race produced a blank
  // thread that merged into the synced set.
  if (opts.isLoading) return false;
  return opts.sessionCount === 0 && !opts.hasActiveSessionId;
}

export interface ReconcileFreePresetInput {
  activePresetId: string;
  personaModels: (string | undefined)[];
  synthesizerModel?: string;
  catalog: any[];
  /** A preset the owner just clicked is authoritative for this window (ms). */
  presetJustAppliedUntil?: number;
}

export interface ReconcileFreePresetResult {
  /** New preset id when free mode must step aside, otherwise null. */
  switchToPresetId: string | null;
  /** Why the switch happened (for the toast). */
  reason: string | null;
}

/**
 * When the active preset is free-tier and the roster contains a model that is
 * NOT verified zero-cost in the live catalog, free mode steps aside to a paid
 * preset. Unknown ≠ paid: without a catalog we never switch. A preset applied
 * moments ago is authoritative and is not immediately undone.
 */
export function reconcileFreePresetWithModels(input: ReconcileFreePresetInput): ReconcileFreePresetResult {
  if (!FREE_TIER_PRESET_IDS.has(input.activePresetId)) {
    return { switchToPresetId: null, reason: null };
  }
  if (input.presetJustAppliedUntil && Date.now() < input.presetJustAppliedUntil) {
    return { switchToPresetId: null, reason: null };
  }
  if (!input.catalog || input.catalog.length === 0) {
    return { switchToPresetId: null, reason: null };
  }
  const models = [...input.personaModels, input.synthesizerModel].filter(
    (m): m is string => Boolean(m && m.trim())
  );
  const allFree = models.every((m) => isFreeModelId(m, input.catalog));
  if (allFree) {
    return { switchToPresetId: null, reason: null };
  }
  return {
    switchToPresetId: PAID_FALLBACK_PRESET_ID,
    reason:
      'Switched preset to Balanced Quality — your hand-picked model(s) are not zero-cost. Your picks stay; free mode was left so costs stay honest.',
  };
}
