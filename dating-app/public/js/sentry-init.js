/**
 * Sentry — Client-side error tracking
 *
 * Loads the Sentry browser SDK from CDN and initializes it.
 * DSN placeholder: replace __YOUR_SENTRY_DSN__ with your real DSN from sentry.io
 *
 * Silent no-op when:
 *   - Running on localhost (dev)
 *   - CDN fails to load
 *   - DSN not configured
 */
(function () {
  var SENTRY_DSN = '__YOUR_SENTRY_DSN__';

  // Skip in development — only track production errors
  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    return;
  }

  // Skip if DSN not configured
  if (!SENTRY_DSN || SENTRY_DSN.indexOf('__YOUR_SENTRY_DSN__') !== -1) {
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
