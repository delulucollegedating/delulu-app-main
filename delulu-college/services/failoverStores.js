'use strict';

// Failover stores for express-rate-limit and express-session.
//
// Each store prefers the shared Redis backend (which is what makes rate limits
// and sessions survive multi-instance deploys) and silently falls back to the
// in-process store while Redis is unreachable. That mirrors the app's existing
// single-instance behaviour during an outage, so users are never hard-blocked
// by a Redis blip.

const { EventEmitter } = require('events');
const { MemoryStore } = require('express-rate-limit');
const { RedisStore: RateLimitRedisStore } = require('rate-limit-redis');
const redisClient = require('./redisClient');

// ===== Rate-limit store (express-rate-limit) =====
// Implements the express-rate-limit store contract (increment/decrement/
// resetKey + optional init/resetAll/shutdown). Each limiter MUST get its own
// instance with a unique `prefix` so counters never collide in Redis.
class FailoverRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix || 'rl:';
    // Can be shared across instances while Redis is up.
    this.localKeys = false;

    const redis = redisClient.getRedis();
    this.redisStore = redis
      ? new RateLimitRedisStore({
          sendCommand: (...args) => redis.call(...args),
          prefix: this.prefix
        })
      : null;
    this.memoryStore = new MemoryStore();
  }

  init(options) {
    // express-rate-limit calls init(options) when the store supports it; the
    // MemoryStore uses it to start its expiry sweep.
    if (this.redisStore && typeof this.redisStore.init === 'function') {
      this.redisStore.init(options);
    }
    if (typeof this.memoryStore.init === 'function') {
      this.memoryStore.init(options);
    }
  }

  async increment(key) {
    if (this._redisUp()) {
      try {
        return await this.redisStore.increment(key);
      } catch (err) {
        // Fall through to the local store for this request.
      }
    }
    return this.memoryStore.increment(key);
  }

  async decrement(key) {
    if (this._redisUp()) {
      try {
        return await this.redisStore.decrement(key);
      } catch (err) {
        // Fall through.
      }
    }
    return this.memoryStore.decrement(key);
  }

  async resetKey(key) {
    if (this._redisUp()) {
      try {
        return await this.redisStore.resetKey(key);
      } catch (err) {
        // Fall through.
      }
    }
    return this.memoryStore.resetKey(key);
  }

  async resetAll() {
    if (this._redisUp() && typeof this.redisStore.resetAll === 'function') {
      try {
        await this.redisStore.resetAll();
      } catch (err) {
        // Ignore — fall through to the local reset.
      }
    }
    if (typeof this.memoryStore.resetAll === 'function') {
      this.memoryStore.resetAll();
    }
  }

  async shutdown() {
    if (this._redisUp() && typeof this.redisStore.shutdown === 'function') {
      try {
        await this.redisStore.shutdown();
      } catch (err) {
        // Ignore.
      }
    }
    if (typeof this.memoryStore.shutdown === 'function') {
      this.memoryStore.shutdown();
    }
  }

  _redisUp() {
    return !!this.redisStore && redisClient.isRedisReady();
  }
}

// Factory: build a fresh, uniquely-prefixed store for one rate limiter.
function createFailoverRateLimitStore(name) {
  return new FailoverRateLimitStore(`rl:${name}:`);
}

// ===== Session store (express-session) =====
// Wraps a connect-redis RedisStore with a memorystore fallback. While Redis is
// reachable, sessions live in Redis (shared across instances, survive
// restarts); while it is not, sessions live in process memory — exactly the
// app's existing non-Redis behaviour. Both inner stores are callback-based,
// matching express-session's expectations.
//
// Extends EventEmitter because express-session subscribes to 'disconnect' /
// 'connect' on the store to track readiness (we never emit them, so sessions
// are always considered ready — the fallback handles availability itself).
class FailoverSessionStore extends EventEmitter {
  constructor(redisStore, memoryStore) {
    super();
    this.redisStore = redisStore;
    this.memoryStore = memoryStore;
  }

  _pick() {
    return this.redisStore && redisClient.isRedisReady() ? this.redisStore : this.memoryStore;
  }

  get(sid, cb) {
    this._pick().get(sid, cb);
  }

  set(sid, sess, cb) {
    this._pick().set(sid, sess, cb);
  }

  destroy(sid, cb) {
    this._pick().destroy(sid, cb);
  }

  touch(sid, sess, cb) {
    const store = this._pick();
    if (typeof store.touch === 'function') {
      store.touch(sid, sess, cb);
    } else if (cb) {
      cb(null);
    }
  }
}

module.exports = { FailoverRateLimitStore, createFailoverRateLimitStore, FailoverSessionStore };
