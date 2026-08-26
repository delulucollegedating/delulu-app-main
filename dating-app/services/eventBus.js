'use strict';

// Cross-instance SSE fan-out.
//
// server.js fans chat/message/user events out through two in-process
// EventEmitters (connectionEmitter, userEmitter). That only reaches SSE streams
// connected to THIS process — on a multi-instance deploy (or during a rolling
// deploy) a message sent via instance A never reached streams on instance B and
// appeared "only after reload". This module bridges the emitters over Redis
// Pub/Sub:
//
//   publish()  -> emits locally (lowest latency for same-instance listeners)
//                 AND fire-and-forget PUBLISHes to a per-bus channel.
//   subscribe  -> a dedicated subscriber connection re-emits every message that
//                 originated on ANOTHER instance onto the local emitter. Own
//                 messages are skipped (already delivered locally), which also
//                 keeps ordering sane and avoids double-writes to clients.
//
// Failure mode mirrors services/failoverStores.js: if REDIS_URL is unset or
// Redis is down, everything still works exactly as the old single-instance
// behaviour (local-only delivery).

const crypto = require('crypto');
const redisClient = require('./redisClient');

const CHANNEL_PREFIX = 'sse:bus:';
// Unique per process boot; used to skip our own echoed publishes.
const INSTANCE_ID = `${process.pid}:${crypto.randomBytes(6).toString('hex')}`;

function createSseBus(name, emitter) {
  const channel = CHANNEL_PREFIX + name;

  function publish(eventName, event) {
    // Always deliver locally first — same-instance listeners keep their
    // existing sub-millisecond path even while Redis is up.
    emitter.emit(eventName, event);

    const redis = redisClient.getRedis();
    if (!redis || !redisClient.isRedisReady()) return;
    const payload = JSON.stringify({ i: INSTANCE_ID, e: eventName, v: event });
    redis.publish(channel, payload).catch((err) => {
      // Local listeners already got the event; losing cross-instance fan-out
      // for one message during a Redis blip is better than crashing a request.
      console.error('[EventBus] publish failed:', err.message);
    });
  }

  function handleIncoming(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // Malformed frame — ignore rather than crash the subscriber.
    }
    if (!msg || typeof msg.e !== 'string') return;
    if (msg.i === INSTANCE_ID) return; // Our own echo — already emitted locally.
    try {
      emitter.emit(msg.e, msg.v);
    } catch (err) {
      console.error('[EventBus] listener error:', err.message);
    }
  }

  return { name, channel, publish, handleIncoming };
}

// Wires a dedicated subscriber connection (SUBSCRIBE mode blocks a connection,
// so it must NOT share the client used for commands) and resubscribes after
// ioredis reconnects. Safe to call once at startup; no-op without REDIS_URL.
function initEventBus(buses) {
  const redis = redisClient.getRedis();
  if (!redis || !buses.length) return false;

  const byChannel = new Map(buses.map((b) => [b.channel, b]));
  let subscriber = null;

  function wire(conn) {
    conn.on('message', (chan, raw) => {
      const bus = byChannel.get(chan);
      if (bus) bus.handleIncoming(raw);
    });
    for (const bus of buses) conn.subscribe(bus.channel).catch(() => {});
    console.log(`[EventBus] Redis Pub/Sub bridge active (${buses.map((b) => b.name).join(', ')}) — SSE events shared across instances.`);
  }

  function setup() {
    // Guard against double-setup: called once either immediately (Redis already
    // ready) or via redis.once('ready').
    if (subscriber) return;
    subscriber = redis.duplicate();
    subscriber.on('error', (err) => {
      console.error('[EventBus] subscriber error:', err.message);
    });
    // Belt-and-braces: ioredis replays SUBSCRIBE commands automatically on
    // reconnect for duplicated connections; this guards against any path where
    // it doesn't (e.g. a fresh duplicate after a fatal connection error).
    subscriber.on('ready', () => {
      for (const bus of buses) subscriber.subscribe(bus.channel).catch(() => {});
    });
    subscriber.on('close', () => {
      console.warn('[EventBus] subscriber disconnected — cross-instance events paused until reconnect.');
    });
    // Only actually subscribe once Redis answers; otherwise queue until ready.
    if (subscriber.status === 'ready') wire(subscriber);
    else subscriber.once('ready', () => wire(subscriber));
  }

  if (redis.status === 'ready') setup();
  else redis.once('ready', setup);

  return true;
}

module.exports = { createSseBus, initEventBus, INSTANCE_ID };
