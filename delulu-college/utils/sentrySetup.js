/**
 * Server-side Sentry Error Tracking Setup
 *
 * Initializes Sentry for production error monitoring, performance tracking,
 * and exception capture. Silent no-op if SENTRY_DSN is not configured.
 *
 * To enable:
 * 1. Sign up at https://sentry.io
 * 2. Create a new Node.js project
 * 3. Add SENTRY_DSN to Railway environment variables
 * 4. Restart the server
 */

const Sentry = require('@sentry/node');
const { ProfilingIntegration } = require('@sentry/profiling-node');

let sentryInitialized = false;

function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;

  // Silent no-op if DSN not configured (prevents startup errors in dev)
  if (!dsn || dsn.trim() === '') {
    console.log('Sentry not configured (SENTRY_DSN missing) - error tracking disabled');
    return { initialized: false };
  }

  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',

      // Release tracking for better error grouping
      release: process.env.RAILWAY_GIT_COMMIT_SHA || `delulu-app@${require('../package.json').version}`,

      // Performance Monitoring
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0, // 10% in prod, 100% in dev

      // Profiling
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      integrations: [
        // Automatic Express instrumentation
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Express({ app }),
        new ProfilingIntegration(),
      ],

      // Don't capture expected errors
      ignoreErrors: [
        'NetworkError',
        'Network request failed',
        'Failed to fetch',
        'Load failed',
        // Rate limiting errors (expected)
        'Too many requests',
        // Auth errors (user-facing, not bugs)
        'Invalid credentials',
        'Session expired',
        'Unauthorized'
      ],

      // Scrub sensitive data from events
      beforeSend(event, hint) {
        // Remove sensitive headers
        if (event.request && event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
          delete event.request.headers['x-admin-secret'];
        }

        // Remove sensitive query params
        if (event.request && event.request.query_string) {
          event.request.query_string = event.request.query_string
            .replace(/token=[^&]+/g, 'token=REDACTED')
            .replace(/password=[^&]+/g, 'password=REDACTED');
        }

        // Remove sensitive body fields
        if (event.request && event.request.data) {
          try {
            const data = typeof event.request.data === 'string'
              ? JSON.parse(event.request.data)
              : event.request.data;

            if (data.password) data.password = 'REDACTED';
            if (data.passcode) data.passcode = 'REDACTED';
            if (data.otp_code) data.otp_code = 'REDACTED';
            if (data.totp_code) data.totp_code = 'REDACTED';

            event.request.data = data;
          } catch (e) {
            // Leave as-is if not JSON
          }
        }

        return event;
      },
    });

    sentryInitialized = true;
    console.log(`Sentry initialized (env: ${process.env.NODE_ENV || 'development'})`);

    return { initialized: true, Sentry };
  } catch (err) {
    console.error('Failed to initialize Sentry:', err.message);
    return { initialized: false };
  }
}

function getSentryMiddleware() {
  if (!sentryInitialized) {
    return {
      requestHandler: (req, res, next) => next(),
      tracingHandler: (req, res, next) => next(),
      errorHandler: (err, req, res, next) => next(err)
    };
  }

  return {
    requestHandler: Sentry.Handlers.requestHandler(),
    tracingHandler: Sentry.Handlers.tracingHandler(),
    errorHandler: Sentry.Handlers.errorHandler()
  };
}

function captureException(error, context = {}) {
  if (!sentryInitialized) return;

  Sentry.captureException(error, {
    extra: context
  });
}

function captureMessage(message, level = 'info', context = {}) {
  if (!sentryInitialized) return;

  Sentry.captureMessage(message, {
    level,
    extra: context
  });
}

function addBreadcrumb(breadcrumb) {
  if (!sentryInitialized) return;
  Sentry.addBreadcrumb(breadcrumb);
}

function setUser(user) {
  if (!sentryInitialized) return;

  Sentry.setUser({
    id: user.id,
    username: user.username,
    ecosystem: user.ecosystem
    // Never include email, phone, or other PII
  });
}

function clearUser() {
  if (!sentryInitialized) return;
  Sentry.setUser(null);
}

module.exports = {
  initSentry,
  getSentryMiddleware,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  clearUser,
  isInitialized: () => sentryInitialized
};
