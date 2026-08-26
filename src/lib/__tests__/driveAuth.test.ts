import { describe, it, expect } from 'vitest';
import { authRecoveryStep, DriveAuthRequiredError } from '../drivePersistence';

describe('Drive auth recovery', () => {
  it('tries a silent refresh first, then a banner — never an unattended picker', () => {
    expect(authRecoveryStep(false)).toBe('silent');
    expect(authRecoveryStep(true)).toBe('banner');
  });

  it('names the error so the lab can keep running locally', () => {
    const err = new DriveAuthRequiredError();
    expect(err.name).toBe('DriveAuthRequiredError');
    expect(err.message).toMatch(/Local copy is still saving/i);
    expect(err.message).toMatch(/Reconnect/i);
  });
});
