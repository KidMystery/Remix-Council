import { getFirebaseIdToken } from './persistence';

/**
 * Generates authentication headers for same-origin backend API calls.
 * Fetches the Firebase ID token of the currently authenticated user if present.
 * Also appends any custom council access secret if configured.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  try {
    const token = await getFirebaseIdToken();
    if (token) {
      headers['X-Firebase-Token'] = token;
    }
  } catch (error) {
    console.warn('[apiClient] Unable to obtain Firebase ID token:', error);
  }

  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      const secret =
        window.localStorage.getItem('councilAccessSecret') ||
        window.localStorage.getItem('council_access_secret');
      if (secret && secret.trim()) {
        headers['X-Council-Access-Secret'] = secret.trim();
      }
    }
  } catch {}

  return headers;
}

/**
 * Check if a URL targets the same origin (or is a relative path).
 * We only attach Firebase ID tokens to same-origin requests.
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
 * Automatically injects the Firebase ID token (`X-Firebase-Token`) and optional access secret
 * without leaking credentials to external providers.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const urlString = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  
  const headers = new Headers(init?.headers || (typeof input === 'object' && 'headers' in input ? (input as Request).headers : undefined) || {});

  if (isSameOriginUrl(urlString)) {
    const authHeaders = await getAuthHeaders();
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
