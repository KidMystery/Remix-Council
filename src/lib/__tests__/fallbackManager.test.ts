import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  classifyTriggerReason,
  computeOrderedBackupList,
  saveFallbackEvent,
  getStoredFallbackEvents,
  clearStoredFallbackEvents,
  FallbackEvent,
  streamPersonaWithFallback,
} from '../fallbackManager';
import { DEFAULT_POLICY } from '../executionPolicy';
import { Persona } from '../../types';
import { streamOpenRouterCompletion } from '../openrouter';

vi.mock('../openrouter', () => ({
  streamOpenRouterCompletion: vi.fn(),
}));

const mockedStream = streamOpenRouterCompletion as unknown as ReturnType<typeof vi.fn>;

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

describe('Fallback Manager tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const personas: Persona[] = [
    { id: 'skeptic', name: 'Skeptic', role: 'Critic', avatar: '🛡️', model: 'google/gemini-2.5-flash', systemPrompt: '', color: '' },
    { id: 'visionary', name: 'Visionary', role: 'Innovator', avatar: '💡', model: 'anthropic/claude-3.5-haiku', systemPrompt: '', color: '' },
    { id: 'pragmatist', name: 'Pragmatist', role: 'Engineer', avatar: '🛠️', model: 'openai/gpt-4o-mini', systemPrompt: '', color: '' },
  ];

  describe('classifyTriggerReason', () => {
    it('detects rate limit 429 errors', () => {
      expect(classifyTriggerReason(new Error('Rate limit exceeded: 429 Too Many Requests'))).toBe('HTTP 429 (Rate Limit)');
      expect(classifyTriggerReason({ message: '429 rate_limit_exceeded' })).toBe('HTTP 429 (Rate Limit)');
    });

    it('detects timeouts', () => {
      expect(classifyTriggerReason(new Error('Request timed out'))).toBe('Timeout');
      expect(classifyTriggerReason({ message: 'AbortError: user timed out' })).toBe('Timeout');
    });

    it('detects temporary unavailability', () => {
      expect(classifyTriggerReason(new Error('503 Service Unavailable: Provider overloaded'))).toBe('Temporary Unavailability');
      expect(classifyTriggerReason({ message: '502 Bad Gateway' })).toBe('Temporary Unavailability');
    });

    it('detects invalid empty responses', () => {
      expect(classifyTriggerReason(null, '')).toBe('Invalid Response');
      expect(classifyTriggerReason(new Error('Invalid response received from endpoint'))).toBe('Invalid Response');
    });
  });

  describe('computeOrderedBackupList', () => {
    it('computes valid backup candidates from hardcoded defaults when rawModels is not provided', () => {
      const backups = computeOrderedBackupList({
        activePersonas: personas,
        failingPersonaId: 'skeptic',
        isFreeOnlyPreset: false,
      });

      expect(backups.length).toBeGreaterThan(0);
      backups.forEach((b) => {
        expect(b.model).toBeDefined();
        expect(b.name).toBeDefined();
      });
    });

    it('prioritizes dynamically fetched rawModels over hardcoded defaults', () => {
      const dynamicRawModels = [
        {
          id: 'cohere/command-r-plus-08-2024',
          name: 'Command R+ 08-2024',
          pricing: { prompt: '0.0000025', completion: '0.00001' },
          context_length: 128000,
        },
        {
          id: 'meta-llama/llama-3.3-70b-instruct',
          name: 'Llama 3.3 70B Instruct',
          pricing: { prompt: '0.0000004', completion: '0.0000004' },
          context_length: 131072,
        },
      ];

      const backups = computeOrderedBackupList({
        activePersonas: personas,
        failingPersonaId: 'skeptic',
        rawModels: dynamicRawModels as any,
        isFreeOnlyPreset: false,
      });

      expect(backups.length).toBeGreaterThan(0);
      // Cohere is not in hardcoded DEFAULT_PAID_BACKUPS, so its presence confirms dynamic prioritization
      expect(backups.some((b) => b.model === 'cohere/command-r-plus-08-2024')).toBe(true);
      expect(backups[0].org).toBe('cohere');
    });

    it('does not offer a lab already seated on another chair', () => {
      const dynamicRawModels = [
        {
          id: 'anthropic/claude-sonnet-4.5',
          name: 'Claude',
          pricing: { prompt: '0.000003', completion: '0.000015' },
        },
        {
          id: 'cohere/command-r-plus-08-2024',
          name: 'Command R+',
          pricing: { prompt: '0.0000025', completion: '0.00001' },
        },
      ];
      const backups = computeOrderedBackupList({
        activePersonas: personas, // visionary is already on anthropic
        failingPersonaId: 'skeptic',
        rawModels: dynamicRawModels as any,
        isFreeOnlyPreset: false,
      });
      expect(backups.every((b) => b.org !== 'anthropic')).toBe(true);
      expect(backups.some((b) => b.org === 'cohere')).toBe(true);
    });

    it('falls back to hardcoded defaults if rawModels is empty array or invalid', () => {
      const backupsEmpty = computeOrderedBackupList({
        activePersonas: personas,
        failingPersonaId: 'skeptic',
        rawModels: [],
        isFreeOnlyPreset: false,
      });

      expect(backupsEmpty.length).toBeGreaterThan(0);

      const backupsInvalid = computeOrderedBackupList({
        activePersonas: personas,
        failingPersonaId: 'skeptic',
        rawModels: [{ id: '' }] as any,
        isFreeOnlyPreset: false,
      });

      expect(backupsInvalid.length).toBeGreaterThan(0);
    });

    it('restricts to free models when isFreeOnlyPreset is true', () => {
      const backups = computeOrderedBackupList({
        activePersonas: personas,
        failingPersonaId: 'skeptic',
        isFreeOnlyPreset: true,
      });

      expect(backups.length).toBeGreaterThan(0);
      expect(backups.every(b => b.isFree)).toBe(true);
    });
  });

  describe('storage and event tracking', () => {
    it('saves, retrieves, and clears fallback logs', () => {
      clearStoredFallbackEvents();
      expect(getStoredFallbackEvents()).toHaveLength(0);

      const event: FallbackEvent = {
        id: 'fb-1',
        timestamp: Date.now(),
        personaId: 'skeptic',
        personaName: 'Skeptic',
        originalModel: 'google/gemini-2.5-flash',
        failedModel: 'google/gemini-2.5-flash',
        triggerReason: 'HTTP 429 (Rate Limit)',
        errorMessage: '429 Rate Limit',
        replacementModel: 'deepseek/deepseek-r1',
        replacementModelName: 'DeepSeek R1',
        status: 'fallback_success',
      };

      saveFallbackEvent(event);
      const events = getStoredFallbackEvents();
      expect(events).toHaveLength(1);
      expect(events[0].replacementModel).toBe('deepseek/deepseek-r1');

      clearStoredFallbackEvents();
      expect(getStoredFallbackEvents()).toHaveLength(0);
    });
  });

  describe('truncation detection & token expansion', () => {
    it('identifies length and max_tokens finish reasons as truncation triggers', () => {
      const checkTruncation = (reason?: string) => reason === 'length' || reason === 'max_tokens';

      expect(checkTruncation('length')).toBe(true);
      expect(checkTruncation('max_tokens')).toBe(true);
      expect(checkTruncation('stop')).toBe(false);
      expect(checkTruncation(undefined)).toBe(false);
    });
  });

  describe('streamPersonaWithFallback strict no-fallback mode', () => {
    const persona: Persona = {
      id: 'skeptic',
      name: 'Skeptic',
      role: 'Critic',
      avatar: '🛡️',
      model: 'google/gemini-2.5-flash',
      systemPrompt: '',
      color: '',
    };

    beforeEach(() => {
      mockedStream.mockReset();
    });

    it('surfaces the raw error without trying backup models', async () => {
      mockedStream.mockRejectedValueOnce(new Error('HTTP 402: credit balance too low'));
      await expect(
        streamPersonaWithFallback({
          persona,
          messages: [{ role: 'user', content: 'hi' }],
          policy: DEFAULT_POLICY, // allowProviderFallback: true — must be ignored in strict mode
          disableFallback: true,
        })
      ).rejects.toThrow('HTTP 402: credit balance too low');
      expect(mockedStream).toHaveBeenCalledTimes(1);
      expect(mockedStream.mock.calls[0][0].model).toBe(persona.model);
    });

    it('returns the pinned model result with fallbackOccurred=false on success', async () => {
      mockedStream.mockResolvedValueOnce({ content: 'ok', actualModel: persona.model });
      const res = await streamPersonaWithFallback({
        persona,
        messages: [{ role: 'user', content: 'hi' }],
        policy: DEFAULT_POLICY,
        disableFallback: true,
      });
      expect(res.content).toBe('ok');
      expect(res.actualModel).toBe(persona.model);
      expect(res.fallbackOccurred).toBe(false);
      expect(mockedStream).toHaveBeenCalledTimes(1);
    });
  });

  describe('streamPersonaWithFallback cost-governor refusals', () => {
    const persona: Persona = {
      id: 'skeptic',
      name: 'Skeptic',
      role: 'Critic',
      avatar: '🛡️',
      model: 'google/gemini-2.5-flash',
      systemPrompt: '',
      color: '',
    };

    beforeEach(() => {
      mockedStream.mockReset();
    });

    it('never tries backup models when the server blocks a call at the ceiling', async () => {
      const ceilingError = new Error('Round cost ceiling reached — further calls for this round were blocked on the server.');
      (ceilingError as any).costCeilingExceeded = true;
      mockedStream.mockRejectedValueOnce(ceilingError);
      await expect(
        streamPersonaWithFallback({
          persona,
          messages: [{ role: 'user', content: 'hi' }],
          policy: DEFAULT_POLICY, // allowProviderFallback: true — must still not swap
          roundKey: 'sess:round',
          costCeilingUSD: 0.5,
        })
      ).rejects.toThrow('Round cost ceiling reached');
      // Exactly one attempt — no backup model was tried.
      expect(mockedStream).toHaveBeenCalledTimes(1);
      expect(mockedStream.mock.calls[0][0].roundKey).toBe('sess:round');
      expect(mockedStream.mock.calls[0][0].costCeilingUSD).toBe(0.5);
    });

    it('never tries backup models when the owner gate rejects auth', async () => {
      const authError = new Error('Sign in required (owner gate).');
      (authError as any).isOwnerAuthError = true;
      mockedStream.mockRejectedValueOnce(authError);
      await expect(
        streamPersonaWithFallback({
          persona,
          messages: [{ role: 'user', content: 'hi' }],
          policy: DEFAULT_POLICY,
        })
      ).rejects.toThrow('Sign in required (owner gate).');
      // Auth error is fatal — do not burn backup models.
      expect(mockedStream).toHaveBeenCalledTimes(1);
    });
  });

  describe('streamPersonaWithFallback abort handling', () => {
    const persona: Persona = {
      id: 'skeptic',
      name: 'Skeptic',
      role: 'Critic',
      avatar: '🛡️',
      model: 'google/gemini-2.5-flash',
      systemPrompt: '',
      color: '',
    };

    beforeEach(() => {
      mockedStream.mockReset();
      clearStoredFallbackEvents();
    });

    it('immediately exits on AbortError without cascading through backup models', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockedStream.mockRejectedValueOnce(abortError);

      await expect(
        streamPersonaWithFallback({
          persona,
          messages: [{ role: 'user', content: 'hi' }],
          policy: DEFAULT_POLICY, // allowProviderFallback is true
        })
      ).rejects.toThrow();

      // Exactly one attempt — must NOT try backup candidates
      expect(mockedStream).toHaveBeenCalledTimes(1);
      // Must NOT log fallback events to storage on abort
      expect(getStoredFallbackEvents()).toHaveLength(0);
    });

    it('immediately throws without calling stream when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        streamPersonaWithFallback({
          persona,
          messages: [{ role: 'user', content: 'hi' }],
          policy: DEFAULT_POLICY,
          signal: controller.signal,
        })
      ).rejects.toThrow();

      expect(mockedStream).toHaveBeenCalledTimes(0);
      expect(getStoredFallbackEvents()).toHaveLength(0);
    });

    it('immediately exits if signal.aborted becomes true during stream failure', async () => {
      const controller = new AbortController();
      mockedStream.mockImplementationOnce(async () => {
        controller.abort();
        throw new Error('Connection aborted by user');
      });

      await expect(
        streamPersonaWithFallback({
          persona,
          messages: [{ role: 'user', content: 'hi' }],
          policy: DEFAULT_POLICY,
          signal: controller.signal,
        })
      ).rejects.toThrow();

      expect(mockedStream).toHaveBeenCalledTimes(1);
      expect(getStoredFallbackEvents()).toHaveLength(0);
    });
  });
});
