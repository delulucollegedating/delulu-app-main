'use strict';

// Optional shared Redis client used by the rate limiter and session stores.
//
// Redis is only activated when REDIS_URL is set. Without it the app keeps using
// its existing in-memory/Postgres stores, so a single-instance deploy needs
// nothing new. When Redis IS configured, both stores fall back to local
// behaviour while Redis is unavailable (see services/failoverStores.js), so a
// Redis outage degrades rather than breaks the app.

const { Redis } = require('ioredis');

let client = null;

function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (client) return client;

  client = new Redis(url, {
    // Keep trying to reconnect instead of giving up on transient blips.
    retryStrategy: (times) => Math.min(times * 200, 5000),
    // Fail a command after a single retry so callers can fall back to local
    // stores instead of hanging forever when Redis is genuinely down.
    maxRetriesPerRequest: 1,
    // While offline, commands queue and flush once the connection returns;
    // callers gate on isRedisReady() so user-facing traffic never queues.
    enableOfflineQueue: true,
    enableReadyCheck: true
  });

  client.on('error', (err) => {
    // ioredis emits 'error' for connection problems — log, never crash.
    console.error('[Redis] connection error:', err.message);
  });
  client.on('ready', () => {
    console.log('[Redis] connected — rate limits & sessions shared across instances.');
  });
  client.on('close', () => {
    console.warn('[Redis] connection closed — using local rate limits/sessions until it reconnects.');
  });
  client.on('reconnecting', () => {
    console.warn('[Redis] reconnecting…');
  });

  return client;
}

function isRedisReady() {
  return !!client && client.status === 'ready';
}

function getRedis() {
  return client;
}

module.exports = { initRedis, isRedisReady, getRedis };
