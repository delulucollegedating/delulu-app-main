import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

const { app, __authTestUtils, __connectionTestUtils } = require('../server.js');
const { generateSSEToken, verifySSEToken, resolveSseCap } = __authTestUtils;
const { sanitizeConnection } = __connectionTestUtils;

describe('SSE connection caps (campus NAT-friendly defaults)', () => {
  it('defaults the per-user cap to 5 (tab-explosion guard)', () => {
    expect(resolveSseCap(undefined, 5)).toBe(5);
    expect(resolveSseCap('', 5)).toBe(5);
    expect(resolveSseCap('not-a-number', 5)).toBe(5);
  });

  it('keeps a high per-IP default so campus NAT users are not refused', () => {
    expect(resolveSseCap(undefined, 500)).toBe(500);
  });

  it('honors env overrides and clamps garbage to the fallback', () => {
    expect(resolveSseCap('50', 500)).toBe(50);
    expect(resolveSseCap('800', 500)).toBe(800);
    expect(resolveSseCap('0', 5)).toBe(5);
    expect(resolveSseCap('-3', 5)).toBe(5);
    expect(resolveSseCap('2.9', 5)).toBe(2);
  });
});

describe('SSE stream tokens (Android EventSource auth)', () => {
  const userId = 777001;

  it('verifies a freshly minted token', () => {
    const token = generateSSEToken(userId);
    expect(token).toBeTruthy();
    expect(verifySSEToken(token)).toBe(userId);
  });

  it('rejects expired tokens (60s TTL)', () => {
    const token = generateSSEToken(userId);
    const [u, exp, sig] = token.split(':');
    // Re-sign with an already-expired expiry to simulate a stale token
    const oldExp = Date.now() - 1000;
    const hmac = crypto.createHmac('sha256', process.env.SESSION_SECRET)
      .update(`${u}:${oldExp}`).digest('hex');
    const expired = `${u}:${oldExp}:${hmac}`;
    expect(verifySSEToken(expired)).toBeNull();
    expect(verifySSEToken(token)).toBe(userId); // live token still fine
  });

  it('rejects tampered and malformed tokens', () => {
    const token = generateSSEToken(userId);
    const parts = token.split(':');
    parts[0] = String(Number(parts[0]) + 1); // different user
    expect(verifySSEToken(parts.join(':'))).toBeNull();

    expect(verifySSEToken(`${token}extra`)).toBeNull();
    expect(verifySSEToken('')).toBeNull();
    expect(verifySSEToken(null)).toBeNull();
    expect(verifySSEToken('abc')).toBeNull();
    expect(verifySSEToken('1:2:3:4')).toBeNull();
    expect(verifySSEToken('not-a-number:12345:deadbeef')).toBeNull();
  });

  it('returns 401 for the SSE endpoints without a session or token', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/user/stream');
    expect(res.status).toBe(401);
  });

  it('requires auth to mint an SSE token', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/sse-token');
    expect(res.status).toBe(401);
  });
});

describe('Meeting flow gate (meeting code only after Day-10 face reveal)', () => {
  const base = {
    id: 'conn-1',
    from_user_id: 1,
    to_user_id: 2,
    status: 'accepted',
    meeting_code: 'abc-defg-hij'
  };

  it('strips the meeting code when only identity reveal (Day 7) is done', () => {
    const out = sanitizeConnection({ ...base, from_identity_reveal: 1, to_identity_reveal: 1 }, 1);
    expect(out.meeting_code).toBeUndefined();
    expect(out.both_identity_revealed).toBe(true);
  });

  it('strips the meeting code when only one user face-revealed', () => {
    const out = sanitizeConnection({ ...base, from_face_reveal: 1, to_face_reveal: 0 }, 1);
    expect(out.meeting_code).toBeUndefined();
  });

  it('keeps the meeting code only when BOTH users completed the face reveal', () => {
    const out = sanitizeConnection({ ...base, from_face_reveal: 1, to_face_reveal: 1 }, 1);
    expect(out.meeting_code).toBe('abc-defg-hij');
    expect(out.both_face_revealed).toBe(true);
  });

  it('also strips legacy meeting codes on documents with no reveal flags', () => {
    const out = sanitizeConnection({ ...base }, 1);
    expect(out.meeting_code).toBeUndefined();
  });
});
