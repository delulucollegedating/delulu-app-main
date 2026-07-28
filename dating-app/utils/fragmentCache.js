/**
 * FragmentCache — In-memory caching for server-rendered HTML/JSON page fragments
 * whose output is identical across users. Includes cache keys accounting for variations
 * like ecosystem, locale, and query params, with TTL expiration and manual invalidation.
 */

class FragmentCache {
  constructor(defaultTTLMs = 60000) {
    this.cache = new Map();
    this.defaultTTLMs = defaultTTLMs;
  }

  generateKey(prefix, req) {
    const eco = (req.session && req.session.user && req.session.user.ecosystem) || 'default';
    const lang = (req.headers && req.headers['accept-language']) ? req.headers['accept-language'].split(',')[0] : 'en';
    const query = req.query ? new URLSearchParams(req.query).toString() : '';
    const path = req.path || '';
    return `${prefix}:${path}:${eco}:${lang}:${query}`;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data, ttlMs = this.defaultTTLMs) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttlMs
    });
  }

  invalidate(pattern) {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  size() {
    return this.cache.size;
  }
}

module.exports = new FragmentCache(60000);
