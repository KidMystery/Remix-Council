import { getGoogleAccessToken } from './drivePersistence';

export const COUNCIL_KEY_STORAGE = 'council_access_key';

export function getCouncilAccessKey(): string {
  try {
    if (typeof process !== 'undefined' && (process.env as any)?.VITE_COUNCIL_ACCESS_KEY !== undefined) {
      const fromProcess = (process.env as any).VITE_COUNCIL_ACCESS_KEY;
      if (fromProcess && typeof fromProcess === 'string' && fromProcess.trim()) return fromProcess.trim();
    }
  } catch {
    // ignore
  }
  try {
    const fromImportMeta = (import.meta as any).env?.VITE_COUNCIL_ACCESS_KEY;
    if (fromImportMeta && typeof fromImportMeta === 'string' && fromImportMeta.trim()) return fromImportMeta.trim();
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    try {
      const stored =
        localStorage.getItem(COUNCIL_KEY_STORAGE) ||
        localStorage.getItem('COUNCIL_ACCESS_KEY') ||
        localStorage.getItem('council_key') ||
        sessionStorage.getItem(COUNCIL_KEY_STORAGE);
      if (stored && stored.trim()) return stored.trim();
    } catch {
      // ignore
    }
    try {
      const match = typeof document !== 'undefined' && document.cookie
        ? document.cookie.match(/(?:^|;\s*)council_access_key=([^;]+)/)
        : null;
      if (match && match[1]) return decodeURIComponent(match[1]).trim();
    } catch {
      // ignore
    }
  }
  return '';
}

export function setCouncilAccessKey(key: string): void {
  const trimmed = (key || '').trim();
  if (typeof window === 'undefined') return;
  try {
    if (trimmed) {
      localStorage.setItem(COUNCIL_KEY_STORAGE, trimmed);
      if (typeof document !== 'undefined') {
        document.cookie = `council_access_key=${encodeURIComponent(trimmed)}; path=/; max-age=31536000; SameSite=Lax`;
      }
    } else {
      localStorage.removeItem(COUNCIL_KEY_STORAGE);
      localStorage.removeItem('COUNCIL_ACCESS_KEY');
      localStorage.removeItem('council_key');
      sessionStorage.removeItem(COUNCIL_KEY_STORAGE);
      if (typeof document !== 'undefined') {
        document.cookie = 'council_access_key=; path=/; max-age=0; SameSite=Lax';
      }
    }
  } catch {
    // ignore
  }
}

// In browser environments: capture access key from URL (?key=... or ?access_key=...)
if (typeof window !== 'undefined' && window.location) {
  try {
    const params = new URLSearchParams(window.location.search);
    const keyParam = params.get('key') || params.get('council_key') || params.get('access_key');
    if (keyParam && keyParam.trim()) {
      setCouncilAccessKey(keyParam.trim());
      params.delete('key');
      params.delete('council_key');
      params.delete('access_key');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
    }
  } catch {
    // ignore
  }
}

/**
 * Generates authentication headers for same-origin backend API calls.
 * Uses the VITE_COUNCIL_ACCESS_KEY client secret (never Firebase tokens).
 */
export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  try {
    const secret = getCouncilAccessKey();
    if (secret && secret.trim()) {
      headers['x-council-key'] = secret.trim();
    }
  } catch (error) {
    console.warn('[apiClient] Unable to obtain council access key:', error);
  }

  try {
    // Owner identity token (Google access token) — proves who is calling to the
    // server's owner gate. Same-origin only; never leaks to external providers.
    const ownerToken = getGoogleAccessToken();
    if (ownerToken) {
      headers['x-owner-token'] = ownerToken;
    }
  } catch (error) {
    console.warn('[apiClient] Unable to obtain owner token:', error);
  }

  return headers;
}

/**
 * Check if a URL targets the same origin (or is a relative path).
 * We only attach council access key headers to same-origin requests.
 */
export function isSameOriginUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
    return true;
  }
  if (!url.includes('://')) {
    return true;
  }
  if (typeof window !== 'undefined' && window.location) {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.origin === window.location.origin;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Centralized authenticated fetch for all backend API communication.
 * Automatically injects the council access key (`x-council-key`) on
 * same-origin requests without leaking credentials to external providers.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const urlString = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

  const headers = new Headers(init?.headers || (typeof input === 'object' && 'headers' in input ? (input as Request).headers : undefined) || {});

  if (isSameOriginUrl(urlString)) {
    const authHeaders = getAuthHeaders();
    for (const [key, value] of Object.entries(authHeaders)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }
  }

  return fetch(input, {
    ...init,
    headers,
  });
}
