import { describe, it, expect, beforeEach } from 'vitest';
import fragmentCache from '../utils/fragmentCache.js';

describe('FragmentCache Server-Rendered Output Caching Tests', () => {
  beforeEach(() => {
    fragmentCache.invalidate(); // Clear all cached entries
  });

  it('should generate distinct cache keys accounting for path, ecosystem, locale, and query params', () => {
    const req1 = { path: '/discover.html', query: { gender: 'female' }, session: { user: { ecosystem: 'vitbhopal' } }, headers: { 'accept-language': 'en-US,en;q=0.9' } };
    const req2 = { path: '/discover.html', query: { gender: 'female' }, session: { user: { ecosystem: 'rishihood' } }, headers: { 'accept-language': 'en-US,en;q=0.9' } };
    const req3 = { path: '/discover.html', query: { gender: 'female' }, session: { user: { ecosystem: 'vitbhopal' } }, headers: { 'accept-language': 'es-ES,es;q=0.9' } };

    const key1 = fragmentCache.generateKey('page', req1);
    const key2 = fragmentCache.generateKey('page', req2);
    const key3 = fragmentCache.generateKey('page', req3);

    expect(key1).not.toBe(key2); // Different ecosystem
    expect(key1).not.toBe(key3); // Different locale
    expect(key1).toContain('vitbhopal');
    expect(key2).toContain('rishihood');
  });

  it('should cache and serve rendered fragment output directly', () => {
    const req = { path: '/api/config/public', query: {}, session: { user: { ecosystem: 'vitbhopal' } }, headers: { 'accept-language': 'en' } };
    const key = fragmentCache.generateKey('config', req);

    const initialData = { appName: 'Delulu', ecosystem: 'vitbhopal' };
    fragmentCache.set(key, initialData, 5000);

    const cached = fragmentCache.get(key);
    expect(cached).toEqual(initialData);
  });

  it('should expire cached fragments after TTL', async () => {
    const req = { path: '/temp', query: {}, session: { user: { ecosystem: 'test' } }, headers: {} };
    const key = fragmentCache.generateKey('temp', req);

    fragmentCache.set(key, { data: 'ephemeral' }, 50); // 50ms TTL
    expect(fragmentCache.get(key)).toEqual({ data: 'ephemeral' });

    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 60));
    expect(fragmentCache.get(key)).toBeNull();
  });

  it('should invalidate matching fragments on content change', () => {
    fragmentCache.set('page:/discover:vitbhopal:en:', { html: '<div>vit</div>' });
    fragmentCache.set('page:/discover:rishihood:en:', { html: '<div>rishi</div>' });

    expect(fragmentCache.size()).toBe(2);
    fragmentCache.invalidate('vitbhopal');
    expect(fragmentCache.size()).toBe(1);
    expect(fragmentCache.get('page:/discover:vitbhopal:en:')).toBeNull();
    expect(fragmentCache.get('page:/discover:rishihood:en:')).not.toBeNull();
  });
});
