import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

const { app, __authTestUtils } = require('../server.js');
const { validatePasswordStrength, isCommonPassword, checkPwnedPassword, MIN_PASSWORD_LENGTH } = __authTestUtils;

// Build a fake HIBP range response whose body contains (or not) the suffix of
// the SHA-1 of the given password — no real network in tests.
function fakePwnedFetcher(password, { breached = true, throws = false } = {}) {
  const sha1 = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const suffix = sha1.slice(5);
  return async () => {
    if (throws) throw new Error('network down');
    return {
      ok: true,
      text: async () => (breached ? `AAA:3\r\n${suffix}:7\r\nBBB:2` : 'AAA:3\r\nBBB:2')
    };
  };
}

describe('Password policy (min 12 + breached-password block)', () => {
  it(`enforces a minimum of ${MIN_PASSWORD_LENGTH} characters`, async () => {
    const res = await validatePasswordStrength('short1', fakePwnedFetcher('short1'));
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/at least 12/);
  });

  it('rejects common weak passwords ("123456", "password")', async () => {
    expect(isCommonPassword('123456')).toBe(true);
    expect(isCommonPassword('PASSWORD')).toBe(true);
    expect(isCommonPassword('delulu123')).toBe(true);
    expect(isCommonPassword('correct-horse-battery-staple')).toBe(false);

    // Use a common password long enough to pass the min-length check first
    const res = await validatePasswordStrength('password123456', fakePwnedFetcher('password123456'));
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/too common/);
  });

  it('accepts a strong password when it is not in any breach', async () => {
    const pwd = 'xK9#mQ2!vL7@pR4';
    const res = await validatePasswordStrength(pwd, fakePwnedFetcher(pwd, { breached: false }));
    expect(res.valid).toBe(true);
    expect(res.error).toBeNull();
  });

  it('rejects a known-breached password via the HaveIBeenPwned k-anonymity check', async () => {
    const pwd = 'xK9#mQ2!vL7@pR4';
    const res = await validatePasswordStrength(pwd, fakePwnedFetcher(pwd, { breached: true }));
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/data breaches/);
  });

  it('fails open when the breach API is unreachable (never blocks signup)', async () => {
    const pwd = 'xK9#mQ2!vL7@pR4';
    const res = await validatePasswordStrength(pwd, fakePwnedFetcher(pwd, { throws: true }));
    expect(res.valid).toBe(true);
    expect(res.error).toBeNull();
  });

  it('checkPwnedPassword returns true only when the suffix matches', async () => {
    const pwd = 'xK9#mQ2!vL7@pR4';
    expect(await checkPwnedPassword(pwd, fakePwnedFetcher(pwd, { breached: true }))).toBe(true);
    expect(await checkPwnedPassword(pwd, fakePwnedFetcher(pwd, { breached: false }))).toBe(false);
    expect(await checkPwnedPassword(pwd, fakePwnedFetcher(pwd, { throws: true }))).toBe(false);
  });
});

describe('Login rate limiting (brute-force protection)', () => {
  it('blocks the 6th login attempt within the 15-minute window', async () => {
    const request = (await import('supertest')).default;
    const creds = { usernameOrEmail: 'no_such_user_abc123', password: 'wrong-password' };
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post('/api/users/login').send(creds);
      statuses.push(res.status);
    }
    // First 5 = failed auth (401), 6th = rate-limited (429)
    expect(statuses.slice(0, 5).every(s => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
