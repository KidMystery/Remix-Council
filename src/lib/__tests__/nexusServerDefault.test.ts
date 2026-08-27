import { describe, it, expect } from 'vitest';
import { NEXUS_SERVER_DEFAULT } from '../nexusMission';

/**
 * Regression pin: Nexus missions launch server-side BY DEFAULT.
 *
 * History: the in-tab loop was the default, which meant a mission started
 * (or resumed) from a phone died silently when the OS froze the browser tab —
 * the mission sat in "running" forever while its actual worker was suspended.
 * Server-default fixes that: the loop lives in server.ts, survives tab close
 * and screen-off, and is bounded by the server-side job cost cap (plus the
 * OpenRouter account hard cap). The in-tab loop stays available as an
 * explicit opt-out via the ☁️ toggle.
 *
 * If you are flipping this test deliberately (e.g., back to in-tab default),
 * also update HANDBOOK.md and the ☁️ toggle copy — and tell the operator why.
 */
describe('NEXUS_SERVER_DEFAULT', () => {
  it('is a boolean (no undefined drift into truthy launch checks)', () => {
    expect(typeof NEXUS_SERVER_DEFAULT).toBe('boolean');
  });

  it('is true — new missions and follow-ups run server-side by default', () => {
    expect(NEXUS_SERVER_DEFAULT).toBe(true);
  });
});
