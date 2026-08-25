/**
 * Chamber lab seating — unique labs from the live catalog, no reserved brands.
 *
 * A council preset stores people (name, role, prompt). The model field is a
 * seating, rewritten from whoever is actually good and live this week.
 * Personality only decides who picks first among leftover labs.
 * Chair is last. Fail closed to unique families, then run + one toast.
 */

import type { Persona, RawOpenRouterModel } from '../types';
import { getAuthorOrganization, getFamily } from './modelMapper';
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
  lab: string;
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
  lab: string;
  model: RawOpenRouterModel;
  score: number;
}

const THIN_TOAST =
  'Catalog is thin — seats could not each get a different lab. The run still went.';

function labOf(modelId: string | undefined): string {
  return getAuthorOrganization(String(modelId || ''));
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
  const byLab = new Map<string, RawOpenRouterModel[]>();
  for (const m of pool) {
    const lab = labOf(m.id);
    if (!lab || lab === 'unknown' || lab === 'openrouter') continue;
    const list = byLab.get(lab) || [];
    list.push(m);
    byLab.set(lab, list);
  }
  const out: LabCandidate[] = [];
  for (const [lab, models] of byLab) {
    let best = models[0];
    let bestScore = -Infinity;
    for (const m of models) {
      const s = scoreCandidateForTier(m, tier);
      if (s > bestScore) {
        bestScore = s;
        best = m;
      }
    }
    out.push({ lab, model: best, score: bestScore });
  }
  out.sort((a, b) => b.score - a.score || a.lab.localeCompare(b.lab));
  return out;
}

function bestUnusedModel(
  pool: RawOpenRouterModel[],
  tier: ModelTier,
  usedIds: Set<string>,
  usedFamilies: Set<string>,
  requireUnusedFamily: boolean
): RawOpenRouterModel | undefined {
  let best: RawOpenRouterModel | undefined;
  let bestScore = -Infinity;
  for (const m of pool) {
    const id = m.id.toLowerCase();
    if (usedIds.has(id)) continue;
    const family = getFamily(m.id);
    if (requireUnusedFamily && family && usedFamilies.has(family)) continue;
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
  const lab = labOf(id);
  if (!lab || lab === 'unknown' || lab === 'openrouter') return null;
  if (uniqueness === 'lab') return `${lab}/*`;
  if (uniqueness === 'family') return getFamily(id) || id;
  return null;
}

/**
 * Greedy unique-lab seating. Chair last. No hardcoded model ids.
 * Offline (empty catalog): keep whatever is already parked.
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
        lab: labOf(model),
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

  const usedLabs = new Set<string>();
  const usedFamilies = new Set<string>();
  const usedIds = new Set<string>();
  let worst: UniquenessLevel = 'lab';

  const mark = (level: UniquenessLevel) => {
    if (level === 'degraded') worst = 'degraded';
    else if (level === 'family' && worst === 'lab') worst = 'family';
  };

  const place = (seatId: string, modelId: string, uniqueness: UniquenessLevel) => {
    const lab = labOf(modelId);
    if (lab && lab !== 'unknown') usedLabs.add(lab);
    const family = getFamily(modelId);
    if (family) usedFamilies.add(family);
    if (modelId) usedIds.add(modelId.toLowerCase());
    mark(uniqueness);
    plan.seats[seatId] = {
      personaId: seatId,
      lab,
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
    const labs = labsFromPool(primaryPool, primaryTier).filter((l) => !usedLabs.has(l.lab));
    if (labs.length > 0) {
      place(s.id, labs[0].model.id, 'lab');
      continue;
    }

    if (primaryTier === 'free' && overflowPool.length > 0) {
      const paidLabs = labsFromPool(overflowPool, 'cheap').filter((l) => !usedLabs.has(l.lab));
      if (paidLabs.length > 0) {
        place(s.id, paidLabs[0].model.id, 'lab');
        continue;
      }
    }

    const familyPick =
      bestUnusedModel(primaryPool, primaryTier, usedIds, usedFamilies, true) ||
      bestUnusedModel(overflowPool, primaryTier === 'free' ? 'cheap' : primaryTier, usedIds, usedFamilies, true);
    if (familyPick) {
      place(s.id, familyPick.id, 'family');
      continue;
    }

    const anyPick =
      bestUnusedModel(primaryPool, primaryTier, usedIds, usedFamilies, false) ||
      bestUnusedModel(overflowPool, primaryTier === 'free' ? 'cheap' : primaryTier, usedIds, usedFamilies, false) ||
      pickBestFromCatalog(catalog, primaryTier === 'free' ? 'cheap' : primaryTier);
    if (anyPick) {
      place(s.id, anyPick.id, 'degraded');
      continue;
    }

    place(s.id, s.model || '', 'degraded');
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
  const labs = models.map((m) => labOf(m)).filter((l) => l && l !== 'unknown');
  return labs.length > 0 && new Set(labs).size === labs.length;
}
