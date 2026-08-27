import { describe, it, expect } from 'vitest';
const request = require('supertest');
const { app } = require('../server.js');

describe('Health check', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBeGreaterThan(0);
  });

  it('GET /health is not rate-limited', async () => {
    // Fire 10 rapid requests — all should succeed (no 429)
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(app).get('/health'))
    );
    results.forEach(res => {
      expect(res.status).toBe(200);
    });
  });
});

describe('Session endpoint (unauthenticated)', () => {
  it('GET /api/session returns { authenticated: false } when not logged in', async () => {
    const res = await request(app).get('/api/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });
});

describe('Auth middleware', () => {
  it('POST /api/users/me returns 401 without auth', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not authenticated/i);
  });

  it('GET /api/discover returns 401 without auth', async () => {
    const res = await request(app).get('/api/discover');
    expect(res.status).toBe(401);
  });
});
