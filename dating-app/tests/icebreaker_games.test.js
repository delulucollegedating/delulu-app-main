import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import cookieSignature from 'cookie-signature';

// vitest.config.js sets VITEST=true and NODE_ENV=development so HTTP→HTTPS redirect won't interfere
const { app, __sessionTestUtils } = require('../server.js');

const TEST_USER_ID = 9999001;

// Mint a real express-session cookie (in-memory store) so the authenticated
// validation paths can be exercised. Every validated request below fails in the
// route handler BEFORE connectionOps.getConnection is reached, so the suite
// never reads or writes Firestore.
let authedCookie = null;
let agent;

beforeAll(async () => {
  agent = request.agent(app);
  const sid = crypto.randomBytes(24).toString('hex');
  await new Promise((resolve, reject) => {
    __sessionTestUtils.sessionStore.set(sid, {
      cookie: { path: '/', httpOnly: true, maxAge: null, expires: null },
      userId: TEST_USER_ID
    }, (err) => (err ? reject(err) : resolve()));
  });
  // express-session 1.19 signs the bare sid and prefixes the marker itself
  // ('s:' + signature.sign(sid, secret)) — sign the bare sid here to match.
  const signed = 's:' + cookieSignature.sign(sid, process.env.SESSION_SECRET);
  authedCookie = `connect.sid=${encodeURIComponent(signed)}`;
});

afterAll(async () => {
  // Best-effort cleanup of the synthetic session.
  if (authedCookie) {
    const match = /connect\.sid=s%3A([^.]+)\./.exec(authedCookie);
    if (match) {
      await new Promise((resolve) => __sessionTestUtils.sessionStore.destroy(match[1], () => resolve()));
    }
  }
});

describe('Icebreaker game endpoints — auth guards', () => {
  it('POST /api/connections/:id/start-game requires authentication', async () => {
    const res = await request(app)
      .post('/api/connections/1/start-game')
      .send({ game_type: 'would-you-rather', question: 'Travel to the past or the future?' });
    expect(res.status).toBe(401);
  });

  it('POST /api/connections/:id/answer-game requires authentication', async () => {
    const res = await request(app)
      .post('/api/connections/1/answer-game')
      .send({ answer: 'A' });
    expect(res.status).toBe(401);
  });

  it('POST /api/connections/:id/clear-game requires authentication', async () => {
    const res = await request(app)
      .post('/api/connections/1/clear-game')
      .send({ game_created_at: new Date().toISOString() });
    expect(res.status).toBe(401);
  });
});

describe('Icebreaker game endpoints — input validation (authenticated, DB-free)', () => {
  it('start-game rejects a missing question', async () => {
    const res = await agent
      .post('/api/connections/1/start-game')
      .set('Cookie', authedCookie)
      .send({ game_type: 'would-you-rather' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/game_type|question/i);
  });

  it('start-game rejects a missing game_type', async () => {
    const res = await agent
      .post('/api/connections/1/start-game')
      .set('Cookie', authedCookie)
      .send({ question: 'Travel to the past or the future?' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/game_type|question/i);
  });

  it('start-game rejects a non-string, non-object question', async () => {
    const res = await agent
      .post('/api/connections/1/start-game')
      .set('Cookie', authedCookie)
      .send({ game_type: 'would-you-rather', question: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/game_type|question/i);
  });

  it('start-game rejects questions over 200 characters', async () => {
    const res = await agent
      .post('/api/connections/1/start-game')
      .set('Cookie', authedCookie)
      .send({ game_type: 'would-you-rather', question: 'x'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });

  it('answer-game rejects a missing answer', async () => {
    const res = await agent
      .post('/api/connections/1/answer-game')
      .set('Cookie', authedCookie)
      .send({ answer: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/answer/i);
  });

  it('answer-game rejects answers over 500 characters', async () => {
    const res = await agent
      .post('/api/connections/1/answer-game')
      .set('Cookie', authedCookie)
      .send({ answer: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });
});
