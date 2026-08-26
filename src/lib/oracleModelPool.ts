/**
 * Oracle model pool — custom models, the Direct-mode model list, and the
 * pure helpers behind Auto-Rotate and the vision guard.
 *
 * Rules (must-hold invariants):
 *  - The live OpenRouter catalog is the source of truth. Every id is
 *    classified against it whenever a catalog is loaded: `live`,
 *    `delisted` (catalog loaded, id not found), or `unknown` (offline).
 *    A delisted id is always surfaced — never silently dropped.
 *  - Hardcoded curated entries (ORACLE_MODEL_OPTIONS) are offline
 *    preferences only; the runtime liveness guard re-validates them.
 *  - Custom models obey the same vision guard as curated ones: the
 *    vision flag is snapshotted from the catalog at add-time and
 *    refreshed whenever a live catalog is available.
 */

import type { RawOpenRouterModel } from '../types';
import { modelHasVision, isOpenRouterRouterId } from './modelScoring';
import { OPENROUTER_AUTO } from './autoRouter';
import {
  ORACLE_MODEL_OPTIONS,
  DEFAULT_ROTATION_ROSTER,
  VISION_SAFE_FALLBACK_MODEL,
} from './oracleStore';

/** Provider-error retry: Auto, never a hardcoded Gemini that can delist. */
export const ORACLE_ERROR_RETRY_MODEL = OPENROUTER_AUTO;

export const CUSTOM_ORACLE_MODELS_KEY = 'council-oracle-custom-models-v1';
export const ORACLE_DIRECT_LIST_KEY = 'council-oracle-direct-list-v1';

export interface OracleCustomModel {
  id: string;
  /** Display name snapshot (from the live catalog when available). */
  name?: string;
  /** Vision snapshot from the catalog at add-time. null = unknown (offline). */
  vision: boolean | null;
  addedAt: number;
}

export interface OracleModelOption {
  id: string;
  name: string;
  tag?: string;
  vision: boolean;
  custom?: boolean;
  status?: OracleModelStatus;
}

export type OracleModelStatus = 'live' | 'delisted' | 'unknown';

/** Trims + lowercases a user-typed model id. Returns null when blank. */
export function normalizeModelId(raw: unknown): string | null {
  const trimmed = String(raw ?? '').trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

const BLOCKED_PROVIDER_PREFIXES = ['local/', 'ollama/', 'lmstudio/'];

/**
 * True when the id is a plausibly-routable OpenRouter model id:
 * `provider/slug` form, no router aliases, no local providers, no
 * whitespace or odd characters.
 */
export function isValidOpenRouterModelId(id: string): boolean {
  const normalized = normalizeModelId(id);
  if (!normalized) return false;
  if (isOpenRouterRouterId(normalized)) return false;
  if (BLOCKED_PROVIDER_PREFIXES.some((p) => normalized.startsWith(p))) return false;
  const slashIdx = normalized.indexOf('/');
  if (slashIdx <= 0 || slashIdx === normalized.length - 1) return false;
  const provider = normalized.slice(0, slashIdx);
  const slug = normalized.slice(slashIdx + 1);
  if (!/^[a-z0-9~][a-z0-9._~-]*$/.test(provider)) return false;
  if (!/^[a-z0-9._:+~-]+$/.test(slug)) return false;
  return true;
}

/**
 * Classifies a model id against the live catalog (source of truth) and the
 * curated list (offline preference). Vision comes from the catalog's
 * architecture data when present; otherwise from the curated snapshot.
 */
export interface CatalogModelSuggestion {
  id: string;
  name: string;
  vision: boolean | null;
}

function suggestionScore(query: string, id: string, name: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const nid = id.toLowerCase();
  const nn = (name || '').toLowerCase();
  const slash = nid.indexOf('/');
  const provider = slash > 0 ? nid.slice(0, slash) : '';
  const slug = slash >= 0 ? nid.slice(slash + 1) : nid;
  if (nid === q) return 1000;
  if (slug === q) return 900;
  if (slug.startsWith(q)) return 800;
  if (nid.startsWith(q)) return 750;
  if (nn.startsWith(q)) return 700;
  if (slug.includes(q)) return 500;
  if (nid.includes(q)) return 400;
  if (nn.includes(q)) return 300;
  if (provider.startsWith(q) || provider.includes(q)) return 250;
  const tokens = q.split(/[\s/]+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => nid.includes(t) || nn.includes(t))) return 350;
  return 0;
}

/**
 * Typeahead against the live catalog. Empty query → no dump.
 * Rank by id / slug / name / provider. Never invent an id that is not in the catalog.
 */
export function suggestCatalogModels(
  query: string,
  catalog: RawOpenRouterModel[] | null | undefined,
  opts: { limit?: number; exclude?: string[] } = {}
): CatalogModelSuggestion[] {
  const q = String(query || '').trim();
  if (!q || !Array.isArray(catalog) || catalog.length === 0) return [];
  const exclude = new Set((opts.exclude || []).map((id) => id.toLowerCase()));
  const limit = Math.max(1, opts.limit ?? 8);
  const scored: Array<CatalogModelSuggestion & { score: number }> = [];
  for (const m of catalog) {
    const id = String(m?.id || '').trim();
    if (!id || exclude.has(id.toLowerCase())) continue;
    const name = String(m.name || id.split('/').pop() || id);
    const score = suggestionScore(q, id, name);
    if (score <= 0) continue;
    scored.push({
      id,
      name,
      vision: modelHasVision(m),
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, limit).map(({ id, name, vision }) => ({ id, name, vision }));
}

/**
 * Image turns need a model that can see. Prefer a live catalog vision id.
 * If the catalog is empty, Auto — never a hardcoded Gemini that can delist.
 */
export function pickLiveVisionFallback(
  catalog: RawOpenRouterModel[] | null | undefined
): string {
  const live = (catalog || []).filter((m) => m?.id && modelHasVision(m));
  if (live.length === 0) return OPENROUTER_AUTO;
  const prefer = live.find((m) => /flash/i.test(m.id) && /gemini|google/i.test(m.id)) || live[0];
  return prefer.id;
}

export function classifyOracleModel(
  id: string,
  catalog: RawOpenRouterModel[] | null | undefined
): { status: OracleModelStatus; vision: boolean | null; name?: string } {
  const normalized = normalizeModelId(id) || '';
  const curated = ORACLE_MODEL_OPTIONS.find((m) => m.id === normalized);
  const catalogEntry = Array.isArray(catalog)
    ? catalog.find((m) => m?.id?.toLowerCase() === normalized)
    : undefined;

  let status: OracleModelStatus = 'unknown';
  let vision: boolean | null = curated ? curated.vision : null;
  let name = curated?.name;

  if (Array.isArray(catalog)) {
    status = catalogEntry ? 'live' : 'delisted';
    if (catalogEntry) {
      vision = modelHasVision(catalogEntry);
      name = catalogEntry.name || name;
    }
  }

  return { status, vision, name };
}

// ---------------------------------------------------------------------------
// Custom model pool (persistent, global across Oracle threads)
// ---------------------------------------------------------------------------

export function loadCustomOracleModels(): OracleCustomModel[] {
  try {
    const raw = localStorage.getItem(CUSTOM_ORACLE_MODELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => m && typeof m.id === 'string');
  } catch (err) {
    console.warn('[OraclePool] Failed to load custom models:', err);
    return [];
  }
}

export function saveCustomOracleModels(models: OracleCustomModel[]): void {
  try {
    localStorage.setItem(CUSTOM_ORACLE_MODELS_KEY, JSON.stringify(models));
  } catch (err) {
    console.warn('[OraclePool] Failed to save custom models:', err);
  }
}

/**
 * Adds a custom model to the pool. The id is normalized, format-validated,
 * and classified against the live catalog (when loaded). The model also
 * joins the Direct-mode list so it is immediately selectable everywhere.
 */
export function addCustomOracleModel(
  id: string,
  catalog: RawOpenRouterModel[] | null | undefined
): { ok: boolean; reason?: string; model?: OracleCustomModel; status?: OracleModelStatus } {
  const normalized = normalizeModelId(id);
  if (!normalized) return { ok: false, reason: 'Enter a model id first.' };
  if (!isValidOpenRouterModelId(normalized)) {
    return {
      ok: false,
      reason:
        'Use the OpenRouter form "provider/model-name" (e.g. z-ai/glm-5.3). Router aliases and local ids are not allowed.',
    };
  }
  const existing = loadCustomOracleModels();
  if (existing.some((m) => m.id === normalized)) {
    return { ok: false, reason: 'That model is already in your list.' };
  }
  const { status, vision, name } = classifyOracleModel(normalized, catalog);
  const model: OracleCustomModel = {
    id: normalized,
    name,
    vision,
    addedAt: Date.now(),
  };
  saveCustomOracleModels([...existing, model]);
  ensureInOracleDirectList(normalized);
  return { ok: true, model, status };
}

/** Removes a custom model from the pool. Returns the updated pool. */
export function removeCustomOracleModel(id: string): OracleCustomModel[] {
  const normalized = normalizeModelId(id);
  if (!normalized) return loadCustomOracleModels();
  const next = loadCustomOracleModels().filter((m) => m.id !== normalized);
  saveCustomOracleModels(next);
  return next;
}

// ---------------------------------------------------------------------------
// Direct-mode model list (the palette behind the Direct picker)
// ---------------------------------------------------------------------------

export function defaultOracleDirectList(): string[] {
  return ORACLE_MODEL_OPTIONS.map((m) => m.id);
}

export function loadOracleDirectList(): string[] {
  try {
    const raw = localStorage.getItem(ORACLE_DIRECT_LIST_KEY);
    if (!raw) return defaultOracleDirectList();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultOracleDirectList();
    const ids = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
    return ids.length > 0 ? ids : defaultOracleDirectList();
  } catch (err) {
    console.warn('[OraclePool] Failed to load direct list:', err);
    return defaultOracleDirectList();
  }
}

export function saveOracleDirectList(ids: string[]): void {
  try {
    localStorage.setItem(ORACLE_DIRECT_LIST_KEY, JSON.stringify(ids));
  } catch (err) {
    console.warn('[OraclePool] Failed to save direct list:', err);
  }
}

/** Adds a model id to the direct list when missing. Returns the new list. */
export function ensureInOracleDirectList(id: string): string[] {
  const normalized = normalizeModelId(id);
  if (!normalized) return loadOracleDirectList();
  const list = loadOracleDirectList();
  if (list.includes(normalized)) return list;
  const next = [...list, normalized];
  saveOracleDirectList(next);
  return next;
}

/**
 * Removes a model id from the direct list. The last remaining entry is kept
 * (use restoreDefaultOracleDirectList to swap the whole palette).
 */
export function removeFromOracleDirectList(id: string): string[] {
  const normalized = normalizeModelId(id);
  if (!normalized) return loadOracleDirectList();
  const list = loadOracleDirectList();
  if (list.length <= 1) return list;
  const next = list.filter((x) => x !== normalized);
  if (next.length === 0) return list;
  saveOracleDirectList(next);
  return next;
}

export function restoreDefaultOracleDirectList(): string[] {
  const next = defaultOracleDirectList();
  saveOracleDirectList(next);
  return next;
}

// ---------------------------------------------------------------------------
// Pure rotation + vision-guard helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Picks the model for an Auto-Rotate turn: deterministic cycling through the
 * roster with wrap-around. Empty/absent rosters fall back to the defaults.
 */
export function resolveRotationModel(
  turnCount: number,
  roster: string[] | null | undefined,
  fallbackRoster: string[] = DEFAULT_ROTATION_ROSTER,
  isUsable?: (id: string) => boolean
): string {
  const list = Array.isArray(roster) && roster.length > 0 ? roster : fallbackRoster;
  const safe = list.length > 0 ? list : DEFAULT_ROTATION_ROSTER;
  const usable = isUsable ? safe.filter(isUsable) : safe;
  if (usable.length > 0) return usable[(turnCount || 0) % usable.length];
  if (isUsable) return ORACLE_ERROR_RETRY_MODEL;
  return safe[(turnCount || 0) % safe.length];
}

/**
 * Applies the vision guard to a roster: text-only models are dropped when
 * images are attached. If nothing in the roster can see images, the whole
 * turn is routed to the vision-safe fallback model instead.
 */
export function filterVisionSafeRoster(
  roster: string[],
  isVisionOk: (id: string) => boolean,
  visionFallbackModel: string = VISION_SAFE_FALLBACK_MODEL
): { safe: string[]; dropped: string[]; usedFallback: boolean } {
  const safe = roster.filter(isVisionOk);
  if (safe.length === 0) {
    return { safe: [visionFallbackModel], dropped: [...roster], usedFallback: true };
  }
  const dropped = roster.filter((id) => !isVisionOk(id));
  return { safe, dropped, usedFallback: false };
}

// ---------------------------------------------------------------------------
// Combined option list (curated + custom) for pickers and badges
// ---------------------------------------------------------------------------

/**
 * Builds the Oracle's model option list: curated defaults plus the user's
 * custom models, each classified against the live catalog. Custom entries
 * keep their stored vision snapshot when the catalog is not loaded.
 */
export function buildOracleModelOptions(
  catalog: RawOpenRouterModel[] | null | undefined,
  customModels: OracleCustomModel[] | null | undefined
): OracleModelOption[] {
  const map = new Map<string, OracleModelOption>();
  for (const opt of ORACLE_MODEL_OPTIONS) {
    map.set(opt.id, { ...opt, status: 'live' as const });
  }
  for (const c of Array.isArray(customModels) ? customModels : []) {
    if (!c || !c.id) continue;
    const { status, vision, name } = classifyOracleModel(c.id, catalog);
    map.set(c.id, {
      id: c.id,
      name: name || c.name || c.id.split('/').pop() || c.id,
      tag: 'Custom',
      // Unknown vision stays lenient (matches the offline guard behavior);
      // the server-side liveness/vision guard re-validates on the next run.
      vision: vision ?? c.vision ?? true,
      custom: true,
      status,
    });
  }
  return Array.from(map.values());
}
