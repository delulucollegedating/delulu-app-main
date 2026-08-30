import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

const { app, __authTestUtils } = require('../server.js');
const { generateAuthToken, verifyAuthToken } = __authTestUtils;

// Build a legacy token the way the pre-revocation code did: HMAC over
// `${userId}:${timestamp}` with NO token_version suffix.
function legacyToken(userId, timestamp) {
  const data = `${userId}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('hex');
  return `${data}:${hmac}`;
}

describe('Auth token revocation (token_version)', () => {
  const userId = 424242;

  it('verifies a token issued under the current version', () => {
    const token = generateAuthToken(userId, 3);
    expect(verifyAuthToken(token, 3)).toBe(userId);
  });

  it('rejects a token after the version is bumped (password change / logout)', () => {
    const oldToken = generateAuthToken(userId, 0);
    // User logs out / changes password -> version bumps to 1
    expect(verifyAuthToken(oldToken, 1)).toBeNull();
  });

  it('accepts a fresh token minted after the bump', () => {
    const freshToken = generateAuthToken(userId, 1);
    expect(verifyAuthToken(freshToken, 1)).toBe(userId);
  });

  it('accepts legacy (pre-version) tokens while the account is still at version 0', () => {
    const ts = Date.now();
    const token = legacyToken(userId, ts);
    expect(verifyAuthToken(token, 0)).toBe(userId);
  });

  it('rejects legacy (pre-version) tokens once the account has been revoked', () => {
    const ts = Date.now();
    const token = legacyToken(userId, ts);
    expect(verifyAuthToken(token, 1)).toBeNull();
  });

  it('rejects tampered tokens', () => {
    const token = generateAuthToken(userId, 0);
    const parts = token.split(':');
    parts[0] = String(Number(parts[0]) + 1); // different userId
    expect(verifyAuthToken(parts.join(':'), 0)).toBeNull();

    const token2 = generateAuthToken(userId, 0);
    expect(verifyAuthToken(`${token2}extra`, 0)).toBeNull();
  });

  it('rejects expired tokens beyond the 30-day TTL', () => {
    const oldTs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const token = generateAuthToken(userId, 0);
    // Re-sign with an old timestamp to simulate a stale token
    const data = `${userId}:${oldTs}:0`;
    const hmac = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('hex');
    const expiredToken = `${userId}:${oldTs}:${hmac}`;
    expect(verifyAuthToken(expiredToken, 0)).toBeNull();
    expect(verifyAuthToken(token, 0)).toBe(userId); // current token still fine
  });

  it('rejects malformed tokens', () => {
    expect(verifyAuthToken('', 0)).toBeNull();
    expect(verifyAuthToken(null, 0)).toBeNull();
    expect(verifyAuthToken('abc', 0)).toBeNull();
    expect(verifyAuthToken('1:2:3:4', 0)).toBeNull();
    expect(verifyAuthToken('not-a-number:12345:deadbeef', 0)).toBeNull();
  });

  it('requires auth for /api/users/me (app still wired up)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });
});
