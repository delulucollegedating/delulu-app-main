/**
 * Sentry — Client-side error tracking
 *
 * Loads the Sentry browser SDK from CDN and initializes it.
 *
 * CRITICAL: Set SENTRY_DSN environment variable or replace placeholder below
 * To get DSN: https://sentry.io/settings/[your-org]/projects/[your-project]/keys/
 *
 * Silent no-op when:
 *   - Running on localhost (dev)
 *   - CDN fails to load
 *   - DSN not configured (prevents production errors)
 */
(function () {
  // CRITICAL: Replace with your actual Sentry DSN from sentry.io
  // Format: https://[key]@[org].ingest.sentry.io/[project-id]
  // Leave as null to disable crash reporting (not recommended for production)
  var SENTRY_DSN = null; // Set to your real DSN: 'https://xxxxx@xxxxx.ingest.sentry.io/xxxxx'

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
