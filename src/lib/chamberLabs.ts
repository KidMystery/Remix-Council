/**
 * Chamber lab seating — unique labs from the live catalog, no reserved brands.
 *
 * A council preset stores people (name, role, prompt). The model field is a
 * seating, rewritten from whoever is actually good and live this week.
 * Personality only decides who picks first among leftover labs.
 * Chair is last. Fail closed to unique families, then run + one toast.
 *
 * L1 fix: uniqueness uses canonicalLab (deepseek-ai → deepseek, meta-llama → meta, xai → x-ai)
 * so two DeepSeek Flash variants (latest + 0731) cannot both seat.
 * Family/degrade skip usedLabs while unused labs remain.
 * Repair pass steals leftover labs.
 * Auto glob stays raw org (meta-llama/* not meta/*).
 */

import type { Persona, RawOpenRouterModel } from '../types';
import { getAuthorOrganization, getFamily, canonicalLab } from './modelMapper';
import {
  isUsableCatalogModel,
  modelHasVision,
  pickBestFromCatalog,
  pricingIsFree,
  scoreCandidateForTier,
  type ModelTier,
} from './modelScoring';

export type UniquenessLevel = 'lab' | 'family' | 'degraded';

export interface ChamberSeatInput {
  id: string;
  name?: string;
  role?: string;
  systemPrompt?: string;
  model?: string;
  enabled?: boolean;
}

export interface ChamberLabSeat {
  personaId: string;
  lab: string; // raw org for display + Auto glob (meta-llama/* stays raw)
  familyFilter: string | null;
  representativeModel: string;
  uniqueness: UniquenessLevel;
}

export interface ChamberLabPlan {
  uniqueness: UniquenessLevel;
  seats: Record<string, ChamberLabSeat>;
  toast?: string;
}

interface LabCandidate {
  canonicalLab: string;
  rawLab: string;
  model: RawOpenRouterModel;
  score: number;
}

const THIN_TOAST =
  'Catalog is thin — seats could not each get a different lab. The run still went.';

function rawLabOf(modelId: string | undefined): string {
  return getAuthorOrganization(String(modelId || ''));
}

function canonicalLabOf(modelId: string | undefined): string {
  return canonicalLab(rawLabOf(modelId));
}

/** Security-ish first, then coach/creative, then numbers, everyone else, Chair last. */
export function seatPickPriority(seat: ChamberSeatInput, chairId: string): number {
  const id = String(seat.id || '').toLowerCase();
  if (id === String(chairId || '').toLowerCase() || id === 'synthesizer') return 80;
  const text = `${seat.name || ''} ${seat.role || ''} ${seat.systemPrompt || ''}`.toLowerCase();
  if (/\b(chair|chairman|consensus builder|synthesi)/.test(text) && /chair|synth/.test(id)) {
    return 80;
  }
  if (
    /skeptic|security|risk|audit|vulnerab|tax|legal|compliance|zero-trust|owasp/.test(text)
  ) {
    return 0;
  }
  if (
    /vision|coach|creative|horizon|brand|narrative|vitality|mindful|wellbeing|wellness|purpose/.test(
      text
    )
  ) {
    return 1;
  }
  if (
    /cash|financ|metric|funnel|pragmat|execution|habit|daily|feasib|unit economics|cfo|roi/.test(
      text
    )
  ) {
    return 2;
  }
  return 3;
}

function tierPool(
  catalog: RawOpenRouterModel[],
  tier: ModelTier,
  requireVision: boolean
): RawOpenRouterModel[] {
  let pool = catalog.filter(isUsableCatalogModel);
  pool =
    tier === 'free'
      ? pool.filter((m) => pricingIsFree(m))
      : pool.filter((m) => !pricingIsFree(m));
  if (requireVision) {
    const vision = pool.filter((m) => modelHasVision(m));
    if (vision.length > 0) pool = vision;
  }
  return pool;
}

function labsFromPool(pool: RawOpenRouterModel[], tier: ModelTier): LabCandidate[] {
  const byCanonical = new Map<string, RawOpenRouterModel[]>();
  for (const m of pool) {
    const raw = rawLabOf(m.id);
    if (!raw || raw === 'unknown' || raw === 'openrouter') continue;
    const canon = canonicalLab(raw);
    if (!canon || canon === 'unknown' || canon === 'openrouter') continue;
    const list = byCanonical.get(canon) || [];
    list.push(m);
    byCanonical.set(canon, list);
  }
  const out: LabCandidate[] = [];
  for (const [canon, models] of byCanonical) {
    let best = models[0];
    let bestScore = -Infinity;
    for (const m of models) {
      const s = scoreCandidateForTier(m, tier);
      if (s > bestScore) {
        bestScore = s;
        best = m;
      }
    }
    const raw = rawLabOf(best.id);
    out.push({ canonicalLab: canon, rawLab: raw, model: best, score: bestScore });
  }
  out.sort((a, b) => b.score - a.score || a.canonicalLab.localeCompare(b.canonicalLab));
  return out;
}

function bestUnusedModel(
  pool: RawOpenRouterModel[],
  tier: ModelTier,
  usedIds: Set<string>,
  usedFamilies: Set<string>,
  usedCanonicalLabs: Set<string>,
  requireUnusedFamily: boolean,
  requireUnusedLab: boolean
): RawOpenRouterModel | undefined {
  let best: RawOpenRouterModel | undefined;
  let bestScore = -Infinity;
  for (const m of pool) {
    const id = m.id.toLowerCase();
    if (usedIds.has(id)) continue;
    const family = getFamily(m.id);
    if (requireUnusedFamily && family && usedFamilies.has(family)) continue;
    if (requireUnusedLab) {
      const canon = canonicalLabOf(m.id);
      if (canon && usedCanonicalLabs.has(canon)) continue;
    }
    const s = scoreCandidateForTier(m, tier);
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

function orderSeats(seats: ChamberSeatInput[], chairId: string): ChamberSeatInput[] {
  return seats
    .map((s, index) => ({ s, index }))
    .sort((a, b) => {
      const pa = seatPickPriority(a.s, chairId);
      const pb = seatPickPriority(b.s, chairId);
      return pa - pb || a.index - b.index;
    })
    .map((x) => x.s);
}

function filterForAllowed(id: string, uniqueness: UniquenessLevel): string | null {
  const raw = rawLabOf(id);
  if (!raw || raw === 'unknown' || raw === 'openrouter') return null;
  if (uniqueness === 'lab') return `${raw}/*`;
  if (uniqueness === 'family') return getFamily(id) || id;
  return null;
}

/**
 * Greedy unique-lab seating. Chair last. No hardcoded model ids.
 * Offline (empty catalog): keep whatever is already parked.
 * L1: uniqueness uses canonicalLab, family/degrade skip usedLabs, repair pass steals leftover labs.
 */
export function allocateChamberLabs(params: {
  seats: ChamberSeatInput[];
  catalog: RawOpenRouterModel[] | null | undefined;
  budget: ModelTier;
  chairId?: string;
  lockedIds?: Record<string, string>;
  visionRequired?: boolean;
}): ChamberLabPlan {
  const chairId = params.chairId || 'synthesizer';
  const lockedIds = params.lockedIds || {};
  const visionRequired = Boolean(params.visionRequired);
  const enabled = (params.seats || []).filter((s) => s && s.id && s.enabled !== false);

  const plan: ChamberLabPlan = { uniqueness: 'lab', seats: {} };
  if (enabled.length === 0) return plan;

  const catalog = Array.isArray(params.catalog) ? params.catalog.filter(isUsableCatalogModel) : [];
  if (catalog.length === 0) {
    for (const s of enabled) {
      const locked = lockedIds[s.id]?.trim();
      const model = locked || s.model || '';
      plan.seats[s.id] = {
        personaId: s.id,
        lab: rawLabOf(model),
        familyFilter: filterForAllowed(model, 'lab'),
        representativeModel: model,
        uniqueness: 'lab',
      };
    }
    return plan;
  }

  const primaryTier: ModelTier = params.budget;
  let primaryPool = tierPool(catalog, primaryTier, visionRequired);
  if (primaryPool.length === 0 && primaryTier === 'free') {
    primaryPool = tierPool(catalog, 'cheap', visionRequired);
  }
  if (primaryPool.length === 0) {
    primaryPool = catalog.filter(isUsableCatalogModel);
  }

  const overflowPool =
    primaryTier === 'free' ? tierPool(catalog, 'cheap', visionRequired) : primaryPool;

  const usedCanonicalLabs = new Set<string>();
  const usedFamilies = new Set<string>();
  const usedIds = new Set<string>();
  let worst: UniquenessLevel = 'lab';

  const mark = (level: UniquenessLevel) => {
    if (level === 'degraded') worst = 'degraded';
    else if (level === 'family' && worst === 'lab') worst = 'family';
  };

  const place = (seatId: string, modelId: string, uniqueness: UniquenessLevel) => {
    const raw = rawLabOf(modelId);
    const canon = canonicalLab(raw);
    if (canon && canon !== 'unknown') usedCanonicalLabs.add(canon);
    const family = getFamily(modelId);
    if (family) usedFamilies.add(family);
    if (modelId) usedIds.add(modelId.toLowerCase());
    mark(uniqueness);
    plan.seats[seatId] = {
      personaId: seatId,
      lab: raw,
      familyFilter: filterForAllowed(modelId, uniqueness),
      representativeModel: modelId,
      uniqueness,
    };
  };

  for (const s of enabled) {
    const locked = lockedIds[s.id]?.trim();
    if (locked) place(s.id, locked, 'lab');
  }

  const remaining = orderSeats(
    enabled.filter((s) => !plan.seats[s.id]),
    chairId
  );

  for (const s of remaining) {
    const labs = labsFromPool(primaryPool, primaryTier).filter(
      (l) => !usedCanonicalLabs.has(l.canonicalLab)
    );
    if (labs.length > 0) {
      place(s.id, labs[0].model.id, 'lab');
      continue;
    }

    if (primaryTier === 'free' && overflowPool.length > 0) {
      const paidLabs = labsFromPool(overflowPool, 'cheap').filter(
        (l) => !usedCanonicalLabs.has(l.canonicalLab)
      );
      if (paidLabs.length > 0) {
        place(s.id, paidLabs[0].model.id, 'lab');
        continue;
      }
    }

    // Family/degrade: first try to keep lab uniqueness while unused labs remain
    const familyPickUnusedLab =
      bestUnusedModel(primaryPool, primaryTier, usedIds, usedFamilies, usedCanonicalLabs, true, true) ||
      bestUnusedModel(
        overflowPool,
        primaryTier === 'free' ? 'cheap' : primaryTier,
        usedIds,
        usedFamilies,
        usedCanonicalLabs,
        true,
        true
      );

    if (familyPickUnusedLab) {
      place(s.id, familyPickUnusedLab.id, 'family');
      continue;
    }

    // If no unused lab left with unused family, try unused lab allowing family reuse
    const familyPickUnusedLabAllowFamily =
      bestUnusedModel(primaryPool, primaryTier, usedIds, usedFamilies, usedCanonicalLabs, false, true) ||
      bestUnusedModel(
        overflowPool,
        primaryTier === 'free' ? 'cheap' : primaryTier,
        usedIds,
        usedFamilies,
        usedCanonicalLabs,
        false,
        true
      );

    if (familyPickUnusedLabAllowFamily) {
      place(s.id, familyPickUnusedLabAllowFamily.id, 'family');
      continue;
    }

    // No unused labs left at all — fall back to family uniqueness even if lab repeats
    const familyPick =
      bestUnusedModel(primaryPool, primaryTier, usedIds, usedFamilies, usedCanonicalLabs, true, false) ||
      bestUnusedModel(
        overflowPool,
        primaryTier === 'free' ? 'cheap' : primaryTier,
        usedIds,
        usedFamilies,
        usedCanonicalLabs,
        true,
        false
      );
    if (familyPick) {
      place(s.id, familyPick.id, 'family');
      continue;
    }

    const anyPickUnusedLab =
      bestUnusedModel(primaryPool, primaryTier, usedIds, usedFamilies, usedCanonicalLabs, false, true) ||
      bestUnusedModel(
        overflowPool,
        primaryTier === 'free' ? 'cheap' : primaryTier,
        usedIds,
        usedFamilies,
        usedCanonicalLabs,
        false,
        true
      );

    if (anyPickUnusedLab) {
      place(s.id, anyPickUnusedLab.id, 'degraded');
      continue;
    }

    const anyPick =
      bestUnusedModel(primaryPool, primaryTier, usedIds, usedFamilies, usedCanonicalLabs, false, false) ||
      bestUnusedModel(
        overflowPool,
        primaryTier === 'free' ? 'cheap' : primaryTier,
        usedIds,
        usedFamilies,
        usedCanonicalLabs,
        false,
        false
      ) ||
      pickBestFromCatalog(catalog, primaryTier === 'free' ? 'cheap' : primaryTier);
    if (anyPick) {
      place(s.id, anyPick.id, 'degraded');
      continue;
    }

    place(s.id, s.model || '', 'degraded');
  }

  // Repair pass: steal leftover labs if duplicates slipped through (e.g., lockedIds or thin family fallback)
  try {
    const canonicalToSeats = new Map<string, string[]>();
    for (const [seatId, seat] of Object.entries(plan.seats)) {
      const canon = canonicalLab(seat.lab);
      const list = canonicalToSeats.get(canon) || [];
      list.push(seatId);
      canonicalToSeats.set(canon, list);
    }

    const hasDuplicates = Array.from(canonicalToSeats.values()).some((arr) => arr.length > 1);
    if (hasDuplicates) {
      const allLabCandidates = labsFromPool([...primaryPool, ...overflowPool, ...catalog], primaryTier);
      const unusedCandidates = allLabCandidates.filter((c) => !usedCanonicalLabs.has(c.canonicalLab));

      if (unusedCandidates.length > 0) {
        for (const [, seatIds] of canonicalToSeats) {
          if (seatIds.length <= 1) continue;
          // Keep first seat (already placed), replace the rest with unused labs
          for (let i = 1; i < seatIds.length; i++) {
            if (unusedCandidates.length === 0) break;
            const replacement = unusedCandidates.shift()!;
            const seatId = seatIds[i];
            // Update tracking
            usedCanonicalLabs.add(replacement.canonicalLab);
            const family = getFamily(replacement.model.id);
            if (family) usedFamilies.add(family);
            if (replacement.model.id) usedIds.add(replacement.model.id.toLowerCase());
            plan.seats[seatId] = {
              personaId: seatId,
              lab: replacement.rawLab,
              familyFilter: filterForAllowed(replacement.model.id, 'lab'),
              representativeModel: replacement.model.id,
              uniqueness: 'lab',
            };
          }
        }
        // Re-evaluate worst after repair
        const uniqLevels = Object.values(plan.seats).map((s) => s.uniqueness);
        if (uniqLevels.every((u) => u === 'lab')) {
          worst = 'lab';
        } else if (uniqLevels.includes('degraded')) {
          worst = 'degraded';
        } else {
          worst = 'family';
        }
      }
    }
  } catch {
    // Repair is best-effort; don't break seating on error
  }

  plan.uniqueness = worst;
  if (worst !== 'lab') plan.toast = THIN_TOAST;
  return plan;
}

export function autoFiltersFromPlan(plan: ChamberLabPlan): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const seat of Object.values(plan.seats)) {
    if (seat.familyFilter) out[seat.personaId] = [seat.familyFilter];
  }
  return out;
}

export function seatCouncilRoster(opts: {
  personas: Persona[];
  synthesizer: Persona;
  catalog: RawOpenRouterModel[] | null | undefined;
  budget: ModelTier;
  lockedIds?: Record<string, string>;
  visionRequired?: boolean;
}): { updatedPersonas: Persona[]; updatedSynthesizer: Persona; plan: ChamberLabPlan } {
  const chairId = opts.synthesizer?.id || 'synthesizer';
  const enabled = (opts.personas || []).filter((p) => p.enabled !== false);
  const plan = allocateChamberLabs({
    seats: [
      ...enabled,
      {
        id: chairId,
        name: opts.synthesizer?.name,
        role: opts.synthesizer?.role,
        systemPrompt: opts.synthesizer?.systemPrompt,
        model: opts.synthesizer?.model,
      },
    ],
    catalog: opts.catalog,
    budget: opts.budget,
    chairId,
    lockedIds: opts.lockedIds,
    visionRequired: opts.visionRequired,
  });

  const updatedPersonas = (opts.personas || []).map((p) => {
    const seat = plan.seats[p.id];
    return seat?.representativeModel ? { ...p, model: seat.representativeModel } : p;
  });
  const chairSeat = plan.seats[chairId];
  const updatedSynthesizer = chairSeat?.representativeModel
    ? { ...opts.synthesizer, model: chairSeat.representativeModel }
    : opts.synthesizer;

  return { updatedPersonas, updatedSynthesizer, plan };
}

export function labsAreUnique(models: Array<string | undefined>): boolean {
  const labs = models
    .map((m) => canonicalLabOf(m))
    .filter((l) => l && l !== 'unknown' && l !== 'openrouter');
  return labs.length > 0 && new Set(labs).size === labs.length;
}
