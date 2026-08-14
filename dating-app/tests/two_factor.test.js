import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

const { authenticator } = require('otplib');
const { __authTestUtils } = require('../server.js');
const {
  generateTotpSecret,
  verifyTotpCode,
  hashBackupCode,
  generateBackupCodes,
  signTotpChallenge,
  verifyTotpChallenge,
  TOTP_BACKUP_CODE_COUNT
} = __authTestUtils;

// ---- Standard RFC 6238 TOTP reference implementation -----------------------
// Independent of the otplib library, so we can prove the drift window really
// accepts codes from adjacent time-steps and rejects stale ones.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(s) {
  let bits = '';
  for (const ch of String(s).toUpperCase().replace(/=+$/g, '')) {
    const v = B32.indexOf(ch);
    if (v === -1) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// 6-digit TOTP for a given epoch (seconds), 30s step, SHA1 — what an authenticator app shows.
function totpAt(secret, epochSeconds) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(epochSeconds / 30)));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return (bin % 1000000).toString().padStart(6, '0');
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('Two-factor authentication (TOTP)', () => {
  it('generates a base32 secret suitable for authenticator apps', () => {
    const secret = generateTotpSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThanOrEqual(16); // >= 16 base32 chars (RFC 4226 minimum)
    expect(secret).toMatch(/^[A-Z2-7]+$/); // base32 alphabet
  });

  it('verifies the live code from an authenticator app', () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it('matches the RFC 6238 reference implementation for the current step', () => {
    const secret = generateTotpSecret();
    expect(authenticator.generate(secret)).toBe(totpAt(secret, nowSeconds()));
  });

  it('accepts codes from adjacent time-steps (±1 step clock drift)', () => {
    const secret = generateTotpSecret();
    const now = nowSeconds();
    expect(verifyTotpCode(secret, totpAt(secret, now - 30))).toBe(true); // 1 step in the past
    expect(verifyTotpCode(secret, totpAt(secret, now + 30))).toBe(true); // 1 step in the future
  });

  it('rejects codes older than the drift window', () => {
    const secret = generateTotpSecret();
    const now = nowSeconds();
    expect(verifyTotpCode(secret, totpAt(secret, now - 60))).toBe(false); // 2 steps back
    expect(verifyTotpCode(secret, totpAt(secret, now - 90))).toBe(false); // 3 steps back
  });

  it('rejects a wrong code, a malformed code, and a missing secret', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, '000000')).toBe(false);
    expect(verifyTotpCode(secret, 'abc')).toBe(false);
    expect(verifyTotpCode(secret, '12345')).toBe(false); // 5 digits
    expect(verifyTotpCode(secret, '1234567')).toBe(false); // 7 digits
    expect(verifyTotpCode(null, '123456')).toBe(false);
    expect(verifyTotpCode(secret, null)).toBe(false);
  });

  it('generates the configured number of unique backup codes', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(TOTP_BACKUP_CODE_COUNT);
    expect(new Set(codes).size).toBe(TOTP_BACKUP_CODE_COUNT);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z2-9]{8}$/); // no I/O/0/1 lookalikes
    }
  });

  it('hashes backup codes — plaintext is never stored', () => {
    const code = 'ABCD2345';
    const hash = hashBackupCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(code);
    // Deterministic — lets the server match a presented code by re-hashing
    expect(hashBackupCode(code)).toBe(hash);
    expect(hashBackupCode('ABCD2346')).not.toBe(hash);
  });

  it('signs a 2FA login challenge that redeems to the user id', () => {
    const challenge = signTotpChallenge(424242);
    expect(challenge).toBeTruthy();
    expect(verifyTotpChallenge(challenge)).toBe(424242);
  });

  it('rejects an expired 2FA challenge', () => {
    // Build an expired challenge directly using the server's own construction
    // (10-minute TTL, HMAC over userId:expires).
    const expires = Date.now() - 1000;
    const payload = `424242:${expires}`;
    const hmac = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex');
    const expired = Buffer.from(`${payload}:${hmac}`, 'utf8').toString('base64url');
    expect(verifyTotpChallenge(expired)).toBeNull();
  });

  it('rejects a tampered or garbage 2FA challenge', () => {
    expect(verifyTotpChallenge('not-a-challenge')).toBeNull();
    expect(verifyTotpChallenge('')).toBeNull();
    expect(verifyTotpChallenge(null)).toBeNull();

    const challenge = signTotpChallenge(424242);
    const decoded = Buffer.from(challenge, 'base64url').toString('utf8');
    const [userId, expires, sig] = decoded.split(':');
    const tampered = Buffer.from(`${userId}:${expires}:${'0'.repeat(sig.length)}`, 'utf8').toString('base64url');
    expect(verifyTotpChallenge(tampered)).toBeNull();
  });
});
