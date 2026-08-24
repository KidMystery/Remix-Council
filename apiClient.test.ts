import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isSameOriginUrl, authenticatedFetch, getAuthHeaders } from '../apiClient';

describe('apiClient & Access Key Safety', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('isSameOriginUrl', () => {
    it('identifies relative paths as same-origin', () => {
      expect(isSameOriginUrl('/api/council')).toBe(true);
      expect(isSameOriginUrl('/api/council/models')).toBe(true);
      expect(isSameOriginUrl('/api/health')).toBe(true);
      expect(isSameOriginUrl('api/council')).toBe(true);
    });

    it('identifies external hosts as cross-origin', () => {
      expect(isSameOriginUrl('https://openrouter.ai/api/v1/chat/completions')).toBe(false);
      expect(isSameOriginUrl('https://generativelanguage.googleapis.com/v1beta/models')).toBe(false);
      expect(isSameOriginUrl('https://api.github.com/repos/owner/repo/zipball')).toBe(false);
      expect(isSameOriginUrl('http://malicious-external-site.com/api/council')).toBe(false);
    });
  });

  describe('authenticatedFetch header injection', () => {
    it('does not send council access keys to external hosts (e.g. OpenRouter or Gemini)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

      await authenticatedFetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(fetchSpy).toHaveBeenCalled();
      const passedInit = fetchSpy.mock.calls[0][1];
      const headers = new Headers(passedInit?.headers);

      expect(headers.get('x-council-key')).toBeNull();
      expect(headers.get('x-api-key-override')).toBeNull();
    });

    it('attaches x-council-key to internal /api/* endpoints when configured', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

      // Simulate a configured VITE_COUNCIL_ACCESS_KEY
      vi.stubEnv('VITE_COUNCIL_ACCESS_KEY', 'test-council-access-key');

      try {
        await authenticatedFetch('/api/council', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        expect(fetchSpy).toHaveBeenCalled();
        const passedInit = fetchSpy.mock.calls[0][1];
        const headers = new Headers(passedInit?.headers);
        expect(headers.get('x-council-key')).toBe('test-council-access-key');
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('exposes a header factory that returns the configured access key', () => {
      vi.stubEnv('VITE_COUNCIL_ACCESS_KEY', 'secret-key-123');

      try {
        const headers = getAuthHeaders();
        expect(headers['x-council-key']).toBe('secret-key-123');
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
