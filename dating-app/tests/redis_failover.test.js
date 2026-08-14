import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit } from 'express-rate-limit';
import session from 'express-session';
import MemoryStoreFactory from 'memorystore';
import { createFailoverRateLimitStore, FailoverSessionStore } from '../services/failoverStores';

// These tests exercise the in-memory fallback path, which is what runs whenever
// REDIS_URL is unset (single-instance deploys and the test suite). The Redis
// path itself needs a live Redis server, so it is covered by the readiness
// gating in services/redisClient.js rather than here.

describe('FailoverRateLimitStore (no Redis configured)', () => {
  let store;

  beforeEach(() => {
    store = createFailoverRateLimitStore('test');
    // express-rate-limit calls init(options) on the store; do the same here so
    // the inner MemoryStore knows its window and can compute reset times.
    store.init({ windowMs: 60 * 1000 });
  });

  it('increments hits locally and returns reset time', async () => {
    const first = await store.increment('user:1');
    expect(first.totalHits).toBe(1);
    expect(first.resetTime.getTime()).toBeGreaterThan(Date.now());

    const second = await store.increment('user:1');
    expect(second.totalHits).toBe(2);
  });

  it('keeps keys isolated between limiters via unique prefixes', async () => {
    const other = createFailoverRateLimitStore('other');
    await store.increment('shared-key');
    await other.increment('shared-key');
    expect((await other.increment('shared-key')).totalHits).toBe(2);
  });

  it('decrements and resets keys', async () => {
    await store.increment('user:1');
    await store.decrement('user:1');
    expect((await store.increment('user:1')).totalHits).toBe(1);

    await store.increment('user:2');
    await store.resetKey('user:2');
    expect((await store.increment('user:2')).totalHits).toBe(1);
  });

  it('satisfies express-rate-limit store validation', () => {
    expect(() =>
      rateLimit({
        windowMs: 60 * 1000,
        max: 5,
        store: createFailoverRateLimitStore('validated')
      })
    ).not.toThrow();
  });
});

describe('FailoverSessionStore (no Redis configured)', () => {
  const MemoryStore = MemoryStoreFactory(session);

  let memoryStore;
  let redisCalls;
  let failover;

  beforeEach(() => {
    memoryStore = new MemoryStore({ checkPeriod: 1000 });
    redisCalls = [];
    // A Redis store that records any attempt to use it — it must never be
    // touched while Redis is not ready.
    const redisStore = {
      get: (...args) => { redisCalls.push(['get', ...args]); throw new Error('redis down'); },
      set: (...args) => { redisCalls.push(['set', ...args]); throw new Error('redis down'); },
      destroy: (...args) => { redisCalls.push(['destroy', ...args]); throw new Error('redis down'); },
      touch: (...args) => { redisCalls.push(['touch', ...args]); throw new Error('redis down'); }
    };
    failover = new FailoverSessionStore(redisStore, memoryStore);
  });

  it('stores and retrieves a session via the in-memory fallback', async () => {
    const sess = { userId: 42, cookie: { originalMaxAge: null, expires: null } };
    await new Promise((resolve, reject) =>
      failover.set('abc', sess, (err) => (err ? reject(err) : resolve()))
    );

    const loaded = await new Promise((resolve, reject) =>
      failover.get('abc', (err, data) => (err ? reject(err) : resolve(data)))
    );
    expect(loaded.userId).toBe(42);
    expect(redisCalls.length).toBe(0);
  });

  it('destroys a session', async () => {
    const sess = { userId: 7, cookie: {} };
    await new Promise((resolve, reject) =>
      failover.set('xyz', sess, (err) => (err ? reject(err) : resolve()))
    );
    await new Promise((resolve, reject) =>
      failover.destroy('xyz', (err) => (err ? reject(err) : resolve()))
    );
    const loaded = await new Promise((resolve) => failover.get('xyz', (_err, data) => resolve(data)));
    expect(loaded).toBeUndefined();
  });

  it('supports touch for rolling sessions', async () => {
    const sess = { userId: 9, cookie: {} };
    await new Promise((resolve, reject) =>
      failover.set('t', sess, (err) => (err ? reject(err) : resolve()))
    );
    await expect(
      new Promise((resolve, reject) =>
        failover.touch('t', sess, (err) => (err ? reject(err) : resolve()))
      )
    ).resolves.toBeUndefined();
  });
});
