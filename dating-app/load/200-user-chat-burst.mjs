#!/usr/bin/env node
/**
 * Opens one SSE stream per configured test user, then starts all configured
 * actions at the same moment. It uses only Node's built-in HTTP clients.
 *
 * Usage:
 *   TARGET_URL=https://staging.example.com \
 *   node load/200-user-chat-burst.mjs --config=load/users.local.json
 */
import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';

const configArg = process.argv.find(arg => arg.startsWith('--config='));
const configPath = configArg?.slice('--config='.length) || 'load/users.local.json';
const targetUrl = process.env.TARGET_URL;
const expectedUsers = Number(process.env.EXPECTED_USERS || 200);

if (!targetUrl) throw new Error('TARGET_URL is required, for example https://staging.example.com');

const users = JSON.parse(await readFile(configPath, 'utf8'));
if (!Array.isArray(users) || users.length !== expectedUsers) {
  throw new Error(`Expected exactly ${expectedUsers} users in ${configPath}; found ${Array.isArray(users) ? users.length : 0}.`);
}

const target = new URL(targetUrl);
const transport = target.protocol === 'https:' ? https : http;
const agent = new transport.Agent({ keepAlive: true, maxSockets: expectedUsers + 25 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeRequest(path, { method = 'GET', token, body, keepOpen = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path,
      method,
      agent,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(keepOpen ? { Accept: 'text/event-stream' } : {})
      }
    }, res => {
      if (keepOpen) {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`SSE ${path} returned ${res.statusCode}`));
          return;
        }
        // Consume heartbeats for the duration of the test without buffering.
        res.on('data', () => {});
        res.on('error', () => {});
        resolve({ req, res });
        return;
      }

      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: res.statusCode || 0, data, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function actionFor(user, index) {
  const action = user.action || 'message';
  if (action === 'message') {
    return {
      path: '/api/messages/send',
      method: 'POST',
      body: {
        connection_id: user.connectionId,
        content: user.message || `Load-test message from virtual user ${index + 1}`,
        client_uuid: `${user.clientUuidPrefix || 'load'}-${Date.now()}-${index}`
      }
    };
  }
  if (action === 'start-game') {
    return {
      path: `/api/connections/${user.connectionId}/start-game`,
      method: 'POST',
      body: {
        game_type: 'would-you-rather',
        question: { q: 'Load-test question', a: 'Option A', b: 'Option B' }
      }
    };
  }
  if (action === 'answer-game') {
    return {
      path: `/api/connections/${user.connectionId}/answer-game`,
      method: 'POST',
      body: { answer: index % 2 === 0 ? 'A' : 'B' }
    };
  }
  throw new Error(`Unknown action '${action}' for user ${index + 1}`);
}

console.log(`Opening ${users.length} authenticated SSE streams against ${target.origin}...`);
const streams = await Promise.all(users.map(user =>
  makeRequest(`/api/connections/${user.connectionId}/stream`, { token: user.token, keepOpen: true })
));
console.log('All streams opened. Sending the concurrent burst in one second...');
await sleep(1000);

const startedAt = performance.now();
const results = await Promise.all(users.map(async (user, index) => {
  const action = actionFor(user, index);
  try {
    const response = await makeRequest(action.path, { method: action.method, token: user.token, body: action.body });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, elapsedMs: performance.now() - startedAt };
  } catch (error) {
    return { ok: false, status: 'network-error', error: error.message, elapsedMs: performance.now() - startedAt };
  }
}));

streams.forEach(({ req, res }) => {
  req.destroy();
  res.destroy();
});
agent.destroy();

const failures = results.filter(result => !result.ok);
const latencies = results.filter(result => result.ok).map(result => result.elapsedMs).sort((a, b) => a - b);
const percentile = p => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)].toFixed(0) : 'n/a';

console.table({
  users: users.length,
  succeeded: results.length - failures.length,
  failed: failures.length,
  p50_ms: percentile(0.50),
  p95_ms: percentile(0.95),
  max_ms: percentile(1.00)
});
if (failures.length) {
  console.error('First failures:', failures.slice(0, 10));
  process.exitCode = 1;
}
