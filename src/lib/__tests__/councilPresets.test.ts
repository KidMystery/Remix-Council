import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCustomCouncilPresets,
  saveCustomCouncilPreset,
  deleteCustomCouncilPreset,
  exportCustomPresetsJSON,
  importCustomPresetsJSON,
  CouncilPreset,
} from '../councilPresets';

// Mock localStorage for node environment
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('Council Presets Storage and Export/Import', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const samplePreset: CouncilPreset = {
    id: 'test-preset-1',
    name: 'Test Science Panel',
    badge: '🔬 Science',
    description: 'A test preset for scientific analysis',
    category: 'custom',
    personas: [
      { id: 'skeptic', name: 'Skeptic', role: 'Critic', avatar: '🛡️', model: 'google/gemini-2.5-flash', systemPrompt: '', color: '' },
    ],
    synthesizer: {
      id: 'synthesizer', name: 'Synthesizer', role: 'Chairman', avatar: '⚖️', model: 'google/gemini-2.5-pro', systemPrompt: '', color: ''
    },
    createdAt: Date.now(),
  };

  it('saves and retrieves custom presets from localStorage', () => {
    saveCustomCouncilPreset(samplePreset);
    const presets = getCustomCouncilPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe('Test Science Panel');
  });

  it('deletes custom presets by id', () => {
    saveCustomCouncilPreset(samplePreset);
    expect(getCustomCouncilPresets()).toHaveLength(1);
    deleteCustomCouncilPreset(samplePreset.id);
    expect(getCustomCouncilPresets()).toHaveLength(0);
  });

  it('exports presets to valid JSON string', () => {
    saveCustomCouncilPreset(samplePreset);
    const jsonStr = exportCustomPresetsJSON();
    expect(typeof jsonStr).toBe('string');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.presets).toBeDefined();
    expect(Array.isArray(parsed.presets)).toBe(true);
    expect(parsed.presets[0].id).toBe(samplePreset.id);
  });

  it('imports presets safely from JSON string', () => {
    const importData = [
      {
        id: 'imported-1',
        name: 'Imported Preset',
        badge: '⭐ Custom',
        description: 'Imported custom test preset',
        category: 'custom',
        personas: samplePreset.personas,
        synthesizer: samplePreset.synthesizer,
        createdAt: Date.now(),
      }
    ];
    const res = importCustomPresetsJSON(JSON.stringify(importData));
    expect(res.success).toBe(true);
    expect(res.count).toBe(1);
    const presets = getCustomCouncilPresets();
    expect(presets.some(p => p.name === 'Imported Preset')).toBe(true);
  });
});
