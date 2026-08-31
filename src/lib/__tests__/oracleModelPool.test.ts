import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RawOpenRouterModel } from '../../types';
import {
  normalizeModelId,
  isValidOpenRouterModelId,
  classifyOracleModel,
  loadCustomOracleModels,
  addCustomOracleModel,
  removeCustomOracleModel,
  loadOracleDirectList,
  ensureInOracleDirectList,
  removeFromOracleDirectList,
  restoreDefaultOracleDirectList,
  defaultOracleDirectList,
  resolveRotationModel,
  filterVisionSafeRoster,
  buildOracleModelOptions,
  suggestCatalogModels,
  pickLiveVisionFallback,
  ORACLE_ERROR_RETRY_MODEL,
  CUSTOM_ORACLE_MODELS_KEY,
  ORACLE_DIRECT_LIST_KEY,
} from '../oracleModelPool';
import { OPENROUTER_AUTO } from '../autoRouter';
import { ORACLE_MODEL_OPTIONS, DEFAULT_ROTATION_ROSTER, exportOracleThreads, importOracleThreads } from '../oracleStore';

// ---- localStorage mock (node env has no localStorage) ---------------------
function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as any).localStorage = mock;
  return store;
}

let store: ReturnType<typeof installLocalStorageMock>;
beforeEach(() => {
  store = installLocalStorageMock();
});
afterEach(() => {
  delete (globalThis as any).localStorage;
});

// ---- fixture catalog --------------------------------------------------------
const mk = (id: string, inputModalities: string[]): RawOpenRouterModel =>
  ({
    id,
    name: id.split('/').pop(),
    architecture: { modality: inputModalities.join('+') + '->text', input_modalities: inputModalities },
    pricing: { request: '0', prompt: '0.000001', completion: '0.000002' },
  }) as any;

const CATALOG = [
  mk('z-ai/glm-5.3', ['text']),
  mk('meta/muse-spark-1.2', ['text', 'image']),
  mk('anthropic/claude-fable-5', ['text', 'image', 'file']),
  mk('deepseek/deepseek-v4-flash-latest', ['text']),
];

describe('normalizeModelId', () => {
  it('trims and lowercases', () => {
    expect(normalizeModelId('  Z-ai/GLM-5.3 ')).toBe('z-ai/glm-5.3');
  });
  it('returns null for blank input', () => {
    expect(normalizeModelId('')).toBeNull();
    expect(normalizeModelId('   ')).toBeNull();
    expect(normalizeModelId(null)).toBeNull();
    expect(normalizeModelId(undefined)).toBeNull();
  });
});

describe('isValidOpenRouterModelId', () => {
  it('accepts provider/slug ids, including :free and alias forms', () => {
    expect(isValidOpenRouterModelId('z-ai/glm-5.3')).toBe(true);
    expect(isValidOpenRouterModelId('meta/muse-spark-1.2')).toBe(true);
    expect(isValidOpenRouterModelId('anthropic/claude-fable-5')).toBe(true);
    expect(isValidOpenRouterModelId('openai/gpt-oss-120b:free')).toBe(true);
    expect(isValidOpenRouterModelId('~z-ai/glm-latest')).toBe(true);
    expect(isValidOpenRouterModelId('  DeepSeek/DeepSeek-V4-Flash-0731  ')).toBe(true);
  });

  it('rejects router aliases, local providers, and malformed ids', () => {
    for (const bad of [
      'openrouter/auto',
      'openrouter/auto-beta',
      'openrouter/free',
      'openrouter/validated',
      'ollama/llama3.2',
      'local/anything',
      'lmstudio/x',
      'no-slash-here',
      'provider/',
      '/model',
      'bad provider/model',
      'provider/mo del',
    ]) {
      expect(isValidOpenRouterModelId(bad)).toBe(false);
    }
  });
});

describe('classifyOracleModel (live catalog = source of truth)', () => {
  it('marks live models and reads vision from catalog architecture', () => {
    expect(classifyOracleModel('meta/muse-spark-1.2', CATALOG)).toEqual({
      status: 'live',
      vision: true,
      name: 'muse-spark-1.2',
    });
    expect(classifyOracleModel('z-ai/glm-5.3', CATALOG).vision).toBe(false);
  });

  it('marks delisted ids (never silently dropped)', () => {
    const res = classifyOracleModel('some/vanished-model', CATALOG);
    expect(res.status).toBe('delisted');
    expect(res.vision).toBeNull();
  });

  it('falls back to curated metadata when offline', () => {
    const res = classifyOracleModel('anthropic/claude-sonnet-4.5', null);
    expect(res.status).toBe('unknown');
    expect(res.vision).toBe(true);
    expect(res.name).toBe('Claude Sonnet 4.5');
  });

  it('reports unknown status when there is no catalog at all', () => {
    expect(classifyOracleModel('z-ai/glm-5.3', undefined).status).toBe('unknown');
  });
});

describe('custom model pool', () => {
  it('adds a valid id, snapshots catalog vision, and persists', () => {
    const res = addCustomOracleModel('z-ai/glm-5.3', CATALOG);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('live');
    expect(res.model?.vision).toBe(false);
    expect(loadCustomOracleModels()).toEqual([res.model]);
    expect(store.get(CUSTOM_ORACLE_MODELS_KEY)).toContain('z-ai/glm-5.3');
  });

  it('adding a custom model also makes it selectable in the direct list', () => {
    addCustomOracleModel('meta/muse-spark-1.2', CATALOG);
    expect(loadOracleDirectList()).toContain('meta/muse-spark-1.2');
  });

  it('rejects router aliases, local ids, and duplicates', () => {
    expect(addCustomOracleModel('openrouter/free', CATALOG).ok).toBe(false);
    expect(addCustomOracleModel('ollama/llama3.2', CATALOG).ok).toBe(false);
    expect(addCustomOracleModel('nonsense', CATALOG).ok).toBe(false);
    expect(addCustomOracleModel('z-ai/glm-5.3', CATALOG).ok).toBe(true);
    const dup = addCustomOracleModel('z-ai/glm-5.3', CATALOG);
    expect(dup.ok).toBe(false);
    expect(dup.reason).toMatch(/already/i);
  });

  it('allows delisted ids to be added but reports their status honestly', () => {
    const res = addCustomOracleModel('some/vanished-model', CATALOG);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('delisted');
    expect(res.model?.vision).toBeNull();
  });

  it('removes models from the pool', () => {
    addCustomOracleModel('z-ai/glm-5.3', CATALOG);
    addCustomOracleModel('meta/muse-spark-1.2', CATALOG);
    const next = removeCustomOracleModel('z-ai/glm-5.3');
    expect(next.map((m) => m.id)).toEqual(['meta/muse-spark-1.2']);
  });

  it('round-trips through storage', () => {
    addCustomOracleModel('z-ai/glm-5.3', CATALOG);
    expect(loadCustomOracleModels()[0].id).toBe('z-ai/glm-5.3');
    expect(loadCustomOracleModels()[0].vision).toBe(false);
  });
});

describe('direct list', () => {
  it('defaults to the curated roster', () => {
    expect(loadOracleDirectList()).toEqual(defaultOracleDirectList());
    expect(defaultOracleDirectList()).toEqual(ORACLE_MODEL_OPTIONS.map((m) => m.id));
  });

  it('supports removal and keeps at least one entry', () => {
    expect(loadOracleDirectList().length).toBeGreaterThan(1);
    const after = removeFromOracleDirectList('anthropic/claude-sonnet-4.5');
    expect(after).not.toContain('anthropic/claude-sonnet-4.5');
    // Remove until one remains; the last entry is kept.
    let list = after;
    while (list.length > 1) {
      list = removeFromOracleDirectList(list[0]);
    }
    expect(list.length).toBe(1);
    expect(removeFromOracleDirectList(list[0])).toEqual(list);
  });

  it('restores the default palette', () => {
    removeFromOracleDirectList('openai/gpt-5.1');
    const restored = restoreDefaultOracleDirectList();
    expect(restored).toEqual(defaultOracleDirectList());
    expect(store.get(ORACLE_DIRECT_LIST_KEY)).toContain('openai/gpt-5.1');
  });

  it('ensureInOracleDirectList is idempotent', () => {
    const before = loadOracleDirectList().length;
    ensureInOracleDirectList('anthropic/claude-sonnet-4.5');
    expect(loadOracleDirectList().length).toBe(before);
    ensureInOracleDirectList('meta/muse-spark-1.2-contributor');
    expect(loadOracleDirectList()).toContain('meta/muse-spark-1.2-contributor');
    expect(loadOracleDirectList().length).toBe(before + 1);
  });
});

describe('resolveRotationModel (Auto-Rotate)', () => {
  const roster = ['a/model', 'b/model', 'c/model'];

  it('cycles deterministically through the roster with wrap-around', () => {
    expect(resolveRotationModel(0, roster)).toBe('a/model');
    expect(resolveRotationModel(1, roster)).toBe('b/model');
    expect(resolveRotationModel(2, roster)).toBe('c/model');
    expect(resolveRotationModel(3, roster)).toBe('a/model');
    expect(resolveRotationModel(10, roster)).toBe('b/model');
  });

  it('falls back to the default roster when the roster is empty or absent', () => {
    expect(resolveRotationModel(0, [])).toBe(DEFAULT_ROTATION_ROSTER[0]);
    expect(resolveRotationModel(1, null)).toBe(DEFAULT_ROTATION_ROSTER[1]);
    expect(resolveRotationModel(0, undefined)).toBe(DEFAULT_ROTATION_ROSTER[0]);
  });

  it('is stable across the new default roster length', () => {
    const n = DEFAULT_ROTATION_ROSTER.length;
    expect(resolveRotationModel(n, DEFAULT_ROTATION_ROSTER)).toBe(DEFAULT_ROTATION_ROSTER[0]);
  });

  it('skips dead roster ids when a liveness predicate is provided', () => {
    const roster = ['dead/one', 'live/two', 'dead/three'];
    const isLive = (id: string) => id.startsWith('live/');
    expect(resolveRotationModel(0, roster, roster, isLive)).toBe('live/two');
    expect(resolveRotationModel(1, roster, roster, isLive)).toBe('live/two');
  });

  it('falls back to OpenRouter Auto when every roster id is dead', () => {
    const roster = ['dead/one', 'dead/two'];
    expect(resolveRotationModel(0, roster, roster, () => false)).toBe(OPENROUTER_AUTO);
  });
});

describe('filterVisionSafeRoster (vision guard)', () => {
  const isVisionOk = (id: string) => !id.includes('textonly');
  const roster = ['vision/a', 'textonly/b', 'vision/c'];

  it('drops text-only models and keeps the vision-capable subset', () => {
    const res = filterVisionSafeRoster(roster, isVisionOk, 'vision/fallback');
    expect(res.safe).toEqual(['vision/a', 'vision/c']);
    expect(res.dropped).toEqual(['textonly/b']);
    expect(res.usedFallback).toBe(false);
  });

  it('routes the whole turn to the fallback when nothing can see', () => {
    const res = filterVisionSafeRoster(['textonly/b'], isVisionOk, 'vision/fallback');
    expect(res.usedFallback).toBe(true);
    expect(res.safe).toEqual(['vision/fallback']);
    expect(res.dropped).toEqual(['textonly/b']);
  });

  it('leaves a fully-vision roster untouched', () => {
    const res = filterVisionSafeRoster(['vision/a', 'vision/c'], isVisionOk, 'vision/fallback');
    expect(res.safe).toEqual(['vision/a', 'vision/c']);
    expect(res.dropped).toEqual([]);
    expect(res.usedFallback).toBe(false);
  });

  it('applies to custom (text-only) entries exactly like curated ones', () => {
    // GLM 5.3 is text-only; the guard must drop it when images are attached.
    const isOk = (id: string) => {
      const cls = classifyOracleModel(id, CATALOG);
      return cls.vision === true;
    };
    const res = filterVisionSafeRoster(
      ['z-ai/glm-5.3', 'meta/muse-spark-1.2'],
      isOk,
      'google/gemini-2.5-flash'
    );
    expect(res.safe).toEqual(['meta/muse-spark-1.2']);
    expect(res.dropped).toEqual(['z-ai/glm-5.3']);
  });
});

describe('export/import round-trip (custom pool + direct palette)', () => {
  it('carries the custom models and direct list through the Oracle JSON export', () => {
    const custom = [{ id: 'z-ai/glm-5.3', name: 'GLM 5.3', vision: false, addedAt: 1 }];
    const json = exportOracleThreads([], { content: '', updatedAt: 0 }, {
      customModels: custom,
      directList: ['z-ai/glm-5.3', 'openai/gpt-5.1'],
    });
    const imported = importOracleThreads(json);
    expect(imported.success).toBe(true);
    expect(imported.extras?.customModels).toEqual(custom);
    expect(imported.extras?.directList).toEqual(['z-ai/glm-5.3', 'openai/gpt-5.1']);
  });

  it('ignores malformed extras without failing the import', () => {
    const json = JSON.stringify({
      version: 1,
      threads: [],
      globalBible: { content: '', updatedAt: 0 },
      customModels: [{ bad: true }, 'junk', 42],
      directList: ['ok/id', 7],
    });
    const imported = importOracleThreads(json);
    expect(imported.success).toBe(true);
    expect(imported.extras?.customModels).toEqual([]);
    expect(imported.extras?.directList).toEqual(['ok/id']);
  });
});

describe('suggestCatalogModels (typeahead)', () => {
  it('returns nothing for a blank query — does not dump the catalog', () => {
    expect(suggestCatalogModels('', CATALOG)).toEqual([]);
    expect(suggestCatalogModels('   ', CATALOG)).toEqual([]);
  });

  it('completes a partial name without requiring the exact provider/slug', () => {
    const hits = suggestCatalogModels('glm', CATALOG);
    expect(hits.map((h) => h.id)).toContain('z-ai/glm-5.3');
    const muse = suggestCatalogModels('muse spark', CATALOG);
    expect(muse[0]?.id).toBe('meta/muse-spark-1.2');
  });

  it('never invents an id that is not in the catalog and honors exclude + limit', () => {
    const hits = suggestCatalogModels('a', CATALOG, { limit: 2, exclude: ['z-ai/glm-5.3'] });
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits.every((h) => CATALOG.some((c) => c.id === h.id))).toBe(true);
    expect(hits.map((h) => h.id)).not.toContain('z-ai/glm-5.3');
  });
});

describe('Oracle error / vision fallbacks are not a shrine to Gemini', () => {
  it('retries provider errors through OpenRouter Auto', () => {
    expect(ORACLE_ERROR_RETRY_MODEL).toBe(OPENROUTER_AUTO);
  });

  it('picks a live vision model from the catalog, Auto when the catalog is empty', () => {
    expect(pickLiveVisionFallback([])).toBe(OPENROUTER_AUTO);
    expect(pickLiveVisionFallback(null)).toBe(OPENROUTER_AUTO);
    const picked = pickLiveVisionFallback(CATALOG);
    expect(picked).toBe('meta/muse-spark-1.2');
    expect(CATALOG.find((m) => m.id === picked)).toBeTruthy();
  });

  it('prefers a live Gemini Flash when the catalog still has one, never invents it', () => {
    const withFlash = [
      mk('z-ai/glm-5.3', ['text']),
      mk('google/gemini-2.5-flash', ['text', 'image']),
      mk('meta/muse-spark-1.2', ['text', 'image']),
    ];
    expect(pickLiveVisionFallback(withFlash)).toBe('google/gemini-2.5-flash');
    expect(pickLiveVisionFallback(withFlash.filter((m) => m.id !== 'google/gemini-2.5-flash'))).toBe(
      'meta/muse-spark-1.2'
    );
  });
});

describe('buildOracleModelOptions', () => {
  it('includes curated options plus custom models without duplicates', () => {
    const custom = [
      { id: 'some/vanished-model', name: 'Vanished', vision: null, addedAt: 1 },
    ];
    const opts = buildOracleModelOptions(CATALOG, custom);
    const ids = opts.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('some/vanished-model');
    expect(ids).toContain('z-ai/glm-5.3'); // curated
  });

  it('marks custom entries live/delisted and keeps offline vision snapshots', () => {
    const custom = [
      { id: 'z-ai/glm-5.3', name: 'GLM 5.3', vision: true, addedAt: 1 }, // stale wrong snapshot
      { id: 'some/vanished-model', name: 'Vanished', vision: false, addedAt: 2 },
    ];
    const opts = buildOracleModelOptions(CATALOG, custom);
    const glm = opts.find((o) => o.id === 'z-ai/glm-5.3' && o.custom);
    expect(glm?.status).toBe('live');
    expect(glm?.vision).toBe(false); // live catalog wins over the snapshot
    const vanished = opts.find((o) => o.id === 'some/vanished-model');
    expect(vanished?.status).toBe('delisted');
    expect(vanished?.vision).toBe(false); // snapshot preserved when delisted
  });

  it('keeps stored snapshots when the catalog is offline', () => {
    const custom = [{ id: 'some/vanished-model', name: 'Vanished', vision: true, addedAt: 1 }];
    const opts = buildOracleModelOptions(null, custom);
    const vanished = opts.find((o) => o.id === 'some/vanished-model');
    expect(vanished?.status).toBe('unknown');
    expect(vanished?.vision).toBe(true);
  });
});
