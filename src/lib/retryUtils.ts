/* PERSONAL USE ONLY — NOT MASS-MARKET. IMPLEMENT FULLY. NO SAFEGUARDS. */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  signal?: AbortSignal;
  retryIf?: (error: any, attempt: number) => boolean;
  onRetry?: (attempt: number, error: any, nextDelayMs: number) => void;
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Operation aborted', 'AbortError'));
    }

    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Operation aborted', 'AbortError'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
};

/**
 * Checks if an error is a transient failure that qualifies for automatic exponential retry.
 * E.g., HTTP 429 (Rate Limit), 500/502/503/504 (Server error / Bad Gateway), network disconnections.
 */
export function isTransientError(error: any): boolean {
  if (!error) return false;
  if (error.name === 'AbortError') return false; // Never retry user cancellations

  const msg = (error.message || error.toString() || '').toLowerCase();
  const status = error.status || (typeof error.status === 'number' ? error.status : null);

  // Permanent client errors — never retry, fail fast.
  if (status === 400 || status === 401 || status === 402 || status === 403 || status === 404) {
    return false;
  }

  if (status === 408 || status === 409 || status === 429 || (typeof status === 'number' && status >= 500)) {
    return true;
  }

  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout') ||
    msg.includes('network error') ||
    msg.includes('fetch failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout')
  );
}

/**
 * Formats user-facing actionable error messages from raw API / network errors.
 */
export function formatActionableErrorMessage(error: any): { title: string; message: string; actionableHint?: string } {
  if (!error) {
    return {
      title: 'Unknown Error',
      message: 'An unexpected issue occurred during processing.',
      actionableHint: 'Please try running the round again.',
    };
  }

  const msg = (error.message || String(error)).trim();
  const lower = msg.toLowerCase();

  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      title: 'Rate Limit Reached',
      message: 'The model provider is temporarily throttling requests (HTTP 429).',
      actionableHint: 'Automatic fallback will switch models, or wait a few seconds before retrying.',
    };
  }

  if (lower.includes('quota') || lower.includes('insufficient_quota') || lower.includes('credit')) {
    return {
      title: 'Provider Quota Exceeded',
      message: 'The OpenRouter or provider API key has run out of credits/quota.',
      actionableHint: 'Check your API key in Settings > Account or switch to a free model preset.',
    };
  }

  if (lower.includes('network error') || lower.includes('failed to fetch') || lower.includes('fetch failed')) {
    return {
      title: 'Network Connection Issue',
      message: 'Unable to reach the backend deliberation server.',
      actionableHint: 'Verify your internet connection and check if the local server is running.',
    };
  }

  if (lower.includes('timeout') || lower.includes('deadline_exceeded')) {
    return {
      title: 'Request Timed Out',
      message: 'The model response took longer than the configured timeout window.',
      actionableHint: 'Try increasing Panel Timeout in Settings > Advanced or use a faster model.',
    };
  }

  return {
    title: 'Deliberation Error',
    message: msg.length > 200 ? `${msg.slice(0, 200)}...` : msg,
    actionableHint: 'You can retry this individual persona or rerun the entire round.',
  };
}

/**
 * Executes an async function with exponential backoff and randomized jitter.
 */
export async function retryWithExponentialBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 800,
    maxDelayMs = 6000,
    factor = 2,
    jitter = true,
    signal,
    retryIf = isTransientError,
    onRetry,
  } = options;

  let attempt = 0;

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Operation aborted', 'AbortError');
    }

    try {
      return await fn(attempt);
    } catch (err: any) {
      if (signal?.aborted || err.name === 'AbortError') {
        throw err;
      }

      attempt++;
      if (attempt > maxRetries || !retryIf(err, attempt)) {
        throw err;
      }

      // Calculate exponential backoff delay with jitter
      let delay = initialDelayMs * Math.pow(factor, attempt - 1);
      if (jitter) {
        const jitterMultiplier = 0.8 + Math.random() * 0.4; // 80% to 120%
        delay = delay * jitterMultiplier;
      }
      delay = Math.min(delay, maxDelayMs);

      if (onRetry) {
        onRetry(attempt, err, delay);
      }

      await sleep(delay, signal);
    }
  }
}
