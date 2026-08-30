/**
 * Diagnostic & Reliability Event Log (Client & Server Catalog)
 *
 * Provides a high-fidelity diagnostic ring buffer and persistent catalog for:
 * - Oracle / Council / Nexus errors and network dropouts
 * - Upstream HTTP failures (429 rate limit, 502/503/504 gateway errors)
 * - Model stream stalls, token governor expansions, and automatic fallbacks
 * - Synchronization and storage errors
 *
 * All events are stored in-memory, backed by localStorage with auto-pruning,
 * and asynchronously synced to the server event log.
 */
import { useState, useEffect } from 'react';

export type EventLevel = 'error' | 'warn' | 'info' | 'success';
export type EventScope =
  | 'oracle'
  | 'chamber'
  | 'nexus'
  | 'network'
  | 'model'
  | 'auth'
  | 'storage'
  | 'system'
  | string;

export interface DiagnosticEvent {
  id: string;
  ts: string; // ISO string
  timestampMs: number;
  level: EventLevel;
  scope: EventScope;
  title: string;
  message: string;
  model?: string;
  status?: number;
  retryCount?: number;
  meta?: Record<string, unknown>;
}

const STORAGE_KEY = 'council_client_event_log_v1';
const MAX_EVENTS = 300;

let inMemoryEvents: DiagnosticEvent[] = [];
let isHydrated = false;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore listener exceptions */
    }
  }
}

function hydrate() {
  if (isHydrated) return;
  isHydrated = true;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          inMemoryEvents = parsed.slice(-MAX_EVENTS);
        }
      }
    }
  } catch {
    // quota or parsing failure — fallback to empty in-memory ring
  }
}

function persist() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inMemoryEvents.slice(-MAX_EVENTS)));
    }
  } catch {
    // ignore storage quota issues
  }
}

/**
 * Sends critical errors to the server event log best-effort.
 */
async function syncToServer(event: DiagnosticEvent) {
  try {
    if (typeof fetch === 'function' && event.level === 'error') {
      await fetch('/api/diagnostics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: event.level,
          scope: event.scope,
          message: `[${event.title}] ${event.message}`,
          meta: {
            ...event.meta,
            clientEventId: event.id,
            model: event.model,
            status: event.status,
            retryCount: event.retryCount,
          },
        }),
      }).catch(() => {});
    }
  } catch {
    // best-effort
  }
}

/**
 * Record a structured diagnostic event.
 */
export function recordEvent(
  params: Omit<DiagnosticEvent, 'id' | 'ts' | 'timestampMs'>
): DiagnosticEvent {
  hydrate();

  const now = Date.now();
  const event: DiagnosticEvent = {
    id: `evt_${now}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date(now).toISOString(),
    timestampMs: now,
    ...params,
  };

  inMemoryEvents.push(event);
  if (inMemoryEvents.length > MAX_EVENTS) {
    inMemoryEvents = inMemoryEvents.slice(-MAX_EVENTS);
  }

  persist();
  notifyListeners();
  syncToServer(event);

  return event;
}

/**
 * Convenience helper to record errors with parsed status and message.
 */
export function recordError(
  scope: EventScope,
  title: string,
  error: unknown,
  meta?: Record<string, unknown>,
  model?: string,
  status?: number
): DiagnosticEvent {
  const message =
    error instanceof Error
      ? error.message || String(error)
      : typeof error === 'string'
      ? error
      : JSON.stringify(error);

  const errorStatus =
    status ??
    (error && typeof error === 'object' && 'status' in error && typeof (error as any).status === 'number'
      ? (error as any).status
      : undefined);

  const errorStack =
    error instanceof Error && error.stack
      ? error.stack.split('\n').slice(0, 5).join('\n')
      : undefined;

  return recordEvent({
    level: 'error',
    scope,
    title,
    message,
    model,
    status: errorStatus,
    meta: {
      ...meta,
      ...(errorStack ? { stack: errorStack } : {}),
    },
  });
}

/**
 * Convenience helper to record warnings (e.g. rate limit backoff, model fallback).
 */
export function recordWarn(
  scope: EventScope,
  title: string,
  message: string,
  meta?: Record<string, unknown>,
  model?: string
): DiagnosticEvent {
  return recordEvent({
    level: 'warn',
    scope,
    title,
    message,
    model,
    meta,
  });
}

/**
 * Convenience helper to record informational events.
 */
export function recordInfo(
  scope: EventScope,
  title: string,
  message: string,
  meta?: Record<string, unknown>,
  model?: string
): DiagnosticEvent {
  return recordEvent({
    level: 'info',
    scope,
    title,
    message,
    model,
    meta,
  });
}

/**
 * Retrieve recent events with optional filtering.
 */
export function getEvents(options?: {
  level?: EventLevel | 'all';
  scope?: EventScope | 'all';
  search?: string;
  limit?: number;
}): DiagnosticEvent[] {
  hydrate();

  let list = [...inMemoryEvents].reverse(); // newest first

  if (options?.level && options.level !== 'all') {
    list = list.filter((e) => e.level === options.level);
  }

  if (options?.scope && options.scope !== 'all') {
    list = list.filter((e) => e.scope.toLowerCase() === options.scope?.toLowerCase());
  }

  if (options?.search && options.search.trim()) {
    const q = options.search.trim().toLowerCase();
    list = list.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.message.toLowerCase().includes(q) ||
        e.scope.toLowerCase().includes(q) ||
        (e.model && e.model.toLowerCase().includes(q))
    );
  }

  if (options?.limit && options.limit > 0) {
    list = list.slice(0, options.limit);
  }

  return list;
}

/**
 * Clear all recorded client-side events.
 */
export function clearEvents(): void {
  inMemoryEvents = [];
  persist();
  notifyListeners();
}

/**
 * Export all events as formatted JSON string.
 */
export function exportEventsAsJSON(): string {
  hydrate();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      totalEvents: inMemoryEvents.length,
      events: [...inMemoryEvents].reverse(),
    },
    null,
    2
  );
}

/**
 * Export all events as readable text log.
 */
export function exportEventsAsText(): string {
  hydrate();
  return inMemoryEvents
    .map(
      (e) =>
        `[${e.ts}] [${e.level.toUpperCase()}] [${e.scope}] ${e.title}: ${e.message}${
          e.model ? ` (model: ${e.model})` : ''
        }${e.status ? ` (status: ${e.status})` : ''}`
    )
    .join('\n');
}

/**
 * Subscribe to event log updates.
 */
export function subscribeToEvents(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook to observe event log changes in UI.
 */
export function useEventLog() {
  const [, setTick] = useState(0);

  useEffect(() => {
    hydrate();
    return subscribeToEvents(() => setTick((t) => t + 1));
  }, []);

  return {
    events: getEvents(),
    getEvents,
    recordEvent,
    recordError,
    recordWarn,
    recordInfo,
    clearEvents,
    exportEventsAsJSON,
    exportEventsAsText,
  };
}
