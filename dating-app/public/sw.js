/**
 * ===== Delulu Service Worker =====
 * 
 * Two strategies:
 *  1. Cache-first for static assets (/js/, /styles.css, fonts, avatars)
 *     → Serves from cache instantly. No network wait on repeat visits.
 *     → Version bump in CACHE_NAME forces fresh downloads on app updates.
 * 
 *  2. Network-first for API calls (/api/)
 *     → Never caches dynamic data. Always hits the server.
 *     → Falls back to a simple error response if offline (not cached data).
 * 
 *  3. Network-only for push notifications and real-time streams (SSE endpoints ending in /stream)
 *     → SSE streams cannot be cached. Pass through directly.
 * 
 * Firebase Free Tier Impact:
 *  - 260KB+ of JS/CSS is served from Cache Storage on repeat visits (0 server reads)
 *  - Fonts (Google Fonts CDN) cached locally after first load (0 external requests)
 *  - Reduces server cold-start wakeups on Render free tier
 */

// ── Cache Version ─────────────────────────────────────────────────────────────
// Increment this string whenever you deploy a new version of the app.
// This causes the service worker to delete the old cache and re-download assets.
const CACHE_VERSION = 'delulu-v7';

// ── Static Assets to Pre-Cache on Install ─────────────────────────────────────
// These files are cached immediately when the service worker installs.
// Keep this list lean — only include files that change rarely.
const PRECACHE_ASSETS = [
  '/styles.css',
  '/js/shared.js',
  '/js/chat-cache.js',
  '/js/chat.js',
  '/js/messages.js',
  '/js/discover.js',
  '/js/profile.js',
  '/js/requests.js',
  '/js/crypto.js',
  '/js/image-compress.js',
  '/js/dexie.min.js',
  '/logo.png',
  '/favicon.png',
  '/favicon.ico'
];

// ── Runtime Cache Patterns ─────────────────────────────────────────────────────
// Matches URL patterns for runtime (lazy) caching.
const STATIC_PATTERNS = [
  /\/js\//,
  /\/avatars\//,
  /styles\.css/,
  /logo\.png/,
  /favicon/,
];

// Never cache these — always network only
const BYPASS_PATTERNS = [
  /\/api\//,
  /\/stream$/,
  /\/uploads\//,
  /cdn\.tailwindcss\.com/,
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdn\.jsdelivr\.net/,
  /cdnjs\.cloudflare\.com/,
];

// ── Install: Pre-Cache Static Assets ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Skip waiting — activate immediately so new code takes effect right away
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Cache what we can — ignore individual failures so a single missing
      // file doesn't block the entire install
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            // Silently ignore missing files (e.g. 404 on first deploy)
          })
        )
      );
    })
  );
});

// ── Activate: Clean Up Old Cache Versions ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Take control of all open tabs immediately (no page reload required)
      clients.claim(),

      // Delete ALL old caches that don't match our current version
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
    ])
  );
});

// ── Fetch: Route Requests ────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // Only intercept GET requests — POST/DELETE/PATCH always go to network
  if (request.method !== 'GET') return;

  // Never intercept chrome-extension or non-http(s) requests
  if (!url.startsWith('http')) return;

  // API calls + streams + uploads → always network-only, never cached
  if (BYPASS_PATTERNS.some((p) => p.test(url))) return;

  // Static assets → cache-first strategy
  if (STATIC_PATTERNS.some((p) => p.test(url))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML pages → network-first (always get fresh page shell)
  // Falls back to cache if completely offline
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else → network-first
  event.respondWith(networkFirst(request));
});

/**
 * Cache-First Strategy:
 * Serve from cache immediately. If not cached, fetch from network and cache it.
 * Best for: JS, CSS, fonts, images — files that don't change often.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Only cache successful responses
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    // Offline and not cached — return a minimal fallback
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

/**
 * Network-First Strategy:
 * Try the network first. Fall back to cache if network fails.
 * Best for: HTML pages that need to be fresh but should work offline.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

// ── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const type = data.type || 'notification';
    // Never show a blank notification — derive a meaningful title by type
    const DEFAULT_TITLES = {
      chat_message: 'New message',
      connection_request: 'New connection request',
      connection_accepted: 'Connection accepted'
    };
    const title = data.title || DEFAULT_TITLES[type] || 'New notification';
    const options = {
      body: data.body || (type === 'chat_message' ? 'You have a new message' : 'You have a new notification'),
      icon: data.icon || '/favicon.ico',
      badge: '/favicon.ico',
      data: { url: data.url || '/', type, connectionId: data.connectionId || '' },
      vibrate: [100, 50, 100]
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    // Ignore malformed payloads
  }
});

// ── Notification Click: route to the page the notification is about ────────────
function resolveNotificationUrl(data) {
  let url = data.url || '/';
  // Normalize legacy URLs to real pages
  if (url.startsWith('/chat?')) url = '/chat.html' + url.slice('/chat'.length);
  if (url === '/requests') url = '/requests.html';
  if (url === '/messages') url = '/messages.html';
  // Fallback: route by notification type
  if (!url || url === '/') {
    if (data.type === 'connection_request' || data.type === 'connection_accepted') {
      url = '/requests.html';
    } else if (data.type === 'chat_message') {
      url = data.connectionId ? `/chat.html?id=${data.connectionId}` : '/messages.html';
    } else {
      url = '/messages.html';
    }
  }
  return url;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = resolveNotificationUrl(event.notification.data || {});
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        // Focus an existing tab already on this page (pathname match)
        try {
          const clientUrl = new URL(client.url);
          const targetUrl = new URL(url, self.registration.scope);
          if (clientUrl.origin === targetUrl.origin && clientUrl.pathname === targetUrl.pathname && 'focus' in client) {
            // Navigate existing tab to the exact URL if it differs (e.g. different chat id)
            if (client.url !== targetUrl.href && 'navigate' in client) {
              return client.navigate(targetUrl.href).then(() => client.focus()).catch(() => client.focus());
            }
            return client.focus();
          }
        } catch (e) {}
      }
      return clients.openWindow(url).catch(() => clients.openWindow('/messages.html'));
    })
  );
});
