import { describe, it, expect } from 'vitest';
import { PRESETS } from '../presets';

describe('Council Presets', () => {
  it('defines valid presets with personas', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(2);

    const freePreset = PRESETS.find((p) => p.id === 'fast_and_free');
    expect(freePreset).toBeDefined();
    expect(freePreset?.policyBudget).toBe('free');
    expect(freePreset?.personas.length).toBeGreaterThanOrEqual(3);
    expect(freePreset?.personas.every((p) => p.model.endsWith(':free'))).toBe(true);

    const deepPreset = PRESETS.find((p) => p.id === 'deep_council');
    expect(deepPreset).toBeDefined();
    expect(deepPreset?.policyBudget).toBe('quality');
    expect(deepPreset?.personas.length).toBeGreaterThanOrEqual(3);
  });
});
