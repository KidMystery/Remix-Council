function getCouncilAccessKey(): string {
  try {
    if (typeof process !== 'undefined' && (process.env as any)?.VITE_COUNCIL_ACCESS_KEY !== undefined) {
      const fromProcess = (process.env as any).VITE_COUNCIL_ACCESS_KEY;
      if (fromProcess) return fromProcess;
    }
  } catch {
    // ignore
  }
  try {
    const fromImportMeta = (import.meta as any).env?.VITE_COUNCIL_ACCESS_KEY;
    if (fromImportMeta) return fromImportMeta;
  } catch {
    // ignore
  }
  return '';
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
