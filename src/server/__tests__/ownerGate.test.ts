import { describe, it, expect } from 'vitest';
import { decideOwnerGate } from '../../../server';

/**
 * The auth matrix for the money route — pinned because the live audit caught
 * a REAL HOLE on Aug 27: with OWNER_EMAIL set but COUNCIL_ACCESS_KEY unset,
 * an anonymous POST (no token, no key) was waved through with next(). On the
 * deployed box that meant strangers could reach OpenRouter with your credits
 * (and the bogus-model error path surfaced as Railway 502s in the audit).
 * The fixed contract: owners configured + no credentials → 401. ALWAYS.
 */
const allow = { allow: true as const };
const base = {
  councilKeyConfigured: false,
  clientKey: '',
  councilKeyMatches: false,
  ownerEmailsConfigured: true,
  token: '',
  tokenEmail: null,
  emailAllowed: (e: string) => e === 'kda11deuce@gmail.com',
};

describe('decideOwnerGate', () => {
  it('THE HOLE (fixed): owners configured, no key configured, no token → 401, not allow', () => {
    expect(decideOwnerGate(base)).toEqual({ allow: false, status: 401, reason: 'signin_required' });
  });

  it('valid council key bypasses (agent credential), even with owners configured', () => {
    expect(
      decideOwnerGate({ ...base, councilKeyConfigured: true, clientKey: 'sekrit', councilKeyMatches: true })
    ).toEqual(allow);
  });

  it('wrong council key + no token → 401', () => {
    expect(
      decideOwnerGate({ ...base, councilKeyConfigured: true, clientKey: 'wrong', councilKeyMatches: false })
    ).toEqual({ allow: false, status: 401, reason: 'signin_required' });
  });

  it('owner token with the right email → allow', () => {
    expect(decideOwnerGate({ ...base, token: 'tok', tokenEmail: 'KDA11DEUCE@gmail.com' })).toEqual(allow);
  });

  it('owner token with the WRONG email → 403', () => {
    expect(decideOwnerGate({ ...base, token: 'tok', tokenEmail: 'stranger@evil.com' })).toEqual({
      allow: false,
      status: 403,
      reason: 'not_owner',
    });
  });

  it('token that fails to resolve an email → 403', () => {
    expect(decideOwnerGate({ ...base, token: 'tok', tokenEmail: null })).toEqual({
      allow: false,
      status: 403,
      reason: 'not_owner',
    });
  });

  it('no owners configured (dev mode) → allow (council-key gate applies separately)', () => {
    expect(decideOwnerGate({ ...base, ownerEmailsConfigured: false })).toEqual(allow);
  });
});
