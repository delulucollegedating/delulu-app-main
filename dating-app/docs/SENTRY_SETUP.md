# Sentry Configuration Guide

## Overview
Sentry provides real-time crash monitoring for both client-side (browser/mobile) and server-side errors. This is **critical** for production—without it, crashes and ANRs are invisible.

## Setup Steps

### 1. Create Sentry Account & Project
1. Go to [sentry.io](https://sentry.io) and create an account
2. Create a new project:
   - Platform: **JavaScript** (for client-side)
   - Give it a name: `delulu-production`
3. Copy your DSN (Data Source Name) — looks like:
   ```
   https://[key]@[org].ingest.sentry.io/[project-id]
   ```

### 2. Configure Client-Side Monitoring

Edit `/dating-app/public/js/sentry-init.js` line 18:

```javascript
// BEFORE:
var SENTRY_DSN = null;

// AFTER:
var SENTRY_DSN = 'https://YOUR_ACTUAL_DSN_HERE@YOUR_ORG.ingest.sentry.io/YOUR_PROJECT_ID';
```

**OR** use environment variable at build time (recommended for Railway):

1. Set Railway environment variable:
   ```
   SENTRY_DSN=https://YOUR_ACTUAL_DSN_HERE@YOUR_ORG.ingest.sentry.io/YOUR_PROJECT_ID
   ```

2. Modify build process to inject it into `sentry-init.js` during deployment.

### 3. Configure Server-Side Monitoring (Optional but Recommended)

Install Sentry Node.js SDK:

```bash
cd dating-app
npm install @sentry/node @sentry/profiling-node
```

Add to top of `server.js` (before any other requires):

```javascript
const Sentry = require("@sentry/node");

if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Strip PII from errors
      if (event.request?.headers) {
        delete event.request.headers['Cookie'];
        delete event.request.headers['Authorization'];
      }
      return event;
    }
  });
}
```

Add error handler middleware (before final error handler):

```javascript
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// ... your routes ...

app.use(Sentry.Handlers.errorHandler());
```

### 4. Verify Setup

After deploying with Sentry DSN configured:

1. Visit your production app
2. Open browser console and run:
   ```javascript
   throw new Error("Test Sentry");
   ```
3. Check Sentry dashboard — error should appear within seconds

### 5. Android Crash Reporting (Firebase Crashlytics)

For native Android crashes (ANRs, native crashes):

1. Firebase Crashlytics is already configured via `google-services.json`
2. Crashes are automatically reported to Firebase Console
3. View at: [Firebase Console → Your Project → Crashlytics](https://console.firebase.google.com)

## Production Checklist

- [ ] Sentry DSN configured in production environment
- [ ] Client-side monitoring enabled (check browser Network tab for Sentry requests)
- [ ] Test error sent and received in Sentry dashboard
- [ ] Firebase Crashlytics active for Android crashes
- [ ] PII stripping verified (no passwords/tokens in error logs)

## Current Status

🔴 **Sentry is currently DISABLED** — line 18 of `sentry-init.js` has `SENTRY_DSN = null`

You must set a real DSN before production launch.
