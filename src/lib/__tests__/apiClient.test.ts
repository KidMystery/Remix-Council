import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isSameOriginUrl, authenticatedFetch } from '../apiClient';
import * as persistence from '../persistence';

describe('apiClient & Auth Token Safety', () => {
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
    it('does not send Firebase tokens to external hosts (e.g. OpenRouter or Gemini)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
      vi.spyOn(persistence, 'getFirebaseIdToken').mockResolvedValue('test-firebase-id-token-12345');

      await authenticatedFetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(fetchSpy).toHaveBeenCalled();
      const passedInit = fetchSpy.mock.calls[0][1];
      const headers = new Headers(passedInit?.headers);

      expect(headers.get('x-firebase-token')).toBeNull();
      expect(headers.get('x-council-access-secret')).toBeNull();
    });

    it('attaches x-firebase-token to internal /api/* endpoints when user is authenticated', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
      vi.spyOn(persistence, 'getFirebaseIdToken').mockResolvedValue('valid-user-id-token');

      await authenticatedFetch('/api/council', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(fetchSpy).toHaveBeenCalled();
      const passedInit = fetchSpy.mock.calls[0][1];
      const headers = new Headers(passedInit?.headers);

      expect(headers.get('x-firebase-token')).toBe('valid-user-id-token');
    });

    it('attaches fallback x-council-access-secret if present in storage', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
      vi.spyOn(persistence, 'getFirebaseIdToken').mockResolvedValue(null);

      const originalWindow = globalThis.window;
      globalThis.window = {
        ...(originalWindow || {}),
        localStorage: {
          getItem: (key: string) => (key === 'council_access_secret' ? 'secret-pass-key' : null),
          setItem: () => {},
          removeItem: () => {},
          clear: () => {},
          length: 1,
          key: () => null,
        } as any,
        location: { origin: 'http://localhost:3000' } as any,
      } as any;

      await authenticatedFetch('/api/council', {
        method: 'POST',
      });

      expect(fetchSpy).toHaveBeenCalled();
      const passedInit = fetchSpy.mock.calls[0][1];
      const headers = new Headers(passedInit?.headers);

      expect(headers.get('x-council-access-secret')).toBe('secret-pass-key');
      globalThis.window = originalWindow;
    });
  });
});
