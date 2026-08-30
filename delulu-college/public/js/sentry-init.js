/**
 * Sentry — Client-side error tracking
 *
 * Loads the Sentry browser SDK from CDN and initializes it.
 *
 * Configuration priority (first found wins):
 *   1. Server-injected window.__SENTRY_DSN__ (from environment variable)
 *   2. Hardcoded SENTRY_DSN below
 *
 * To enable:
 *   Option A: Set Railway environment variable SENTRY_DSN (recommended)
 *   Option B: Replace SENTRY_DSN = null below with your actual DSN
 *
 * To get DSN: https://sentry.io/settings/[your-org]/projects/[your-project]/keys/
 *
 * Silent no-op when:
 *   - Running on localhost (dev)
 *   - CDN fails to load
 *   - DSN not configured (prevents production errors)
 */
(function () {
  // Check for server-injected DSN first (from Railway environment variable)
  var SENTRY_DSN = window.__SENTRY_DSN__ || null;

  // Fallback: Hardcoded DSN (replace null with your actual DSN if not using env var)
  // Format: https://[key]@[org].ingest.sentry.io/[project-id]
  if (!SENTRY_DSN) {
    SENTRY_DSN = null; // Replace with: 'https://xxxxx@xxxxx.ingest.sentry.io/xxxxx'
  }

  // Skip in development — only track production errors
  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    return;
  }

  // Skip if DSN not configured - silent no-op instead of breaking
  if (!SENTRY_DSN || SENTRY_DSN.indexOf('__YOUR_SENTRY_DSN__') !== -1) {
    console.warn('[Sentry] Crash reporting not configured - set SENTRY_DSN to enable');
    return;
  }

  var script = document.createElement('script');
  script.src =
    'https://browser.sentry-cdn.com/7.119.0/bundle.min.js';
  script.crossOrigin = 'anonymous';
  script.onload = function () {
    window.Sentry.init({
      dsn: SENTRY_DSN,
      environment: window.location.hostname.includes('railway')
        ? 'production'
        : 'staging',
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      // Don't track PII — strip default HTTP headers
      beforeSend: function (event) {
        if (event.request && event.request.headers) {
          delete event.request.headers['Cookie'];
          delete event.request.headers['Authorization'];
        }
        return event;
      },
    });
  };
  // CDN down? Silently continue — error tracking is optional
  script.onerror = function () {};
  document.head.appendChild(script);
})();
