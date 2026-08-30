# Production Environment Variables

This document lists all required and optional environment variables for Delulu in production.

## ⚠️ Critical: Required for Production

These variables MUST be set before deploying to production. The app will fail or have severely degraded functionality without them.

### Authentication & Sessions

```bash
# Session secret for HMAC token generation (REQUIRED)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=your-64-character-hex-string

# Session store requirement in production (default: true)
# Set to 'false' only for local dev — production REQUIRES persistent sessions
REQUIRE_PERSISTENT_SESSIONS=true
```

### Firebase (Firestore Database)

```bash
# Firebase Admin SDK credentials (REQUIRED)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour\nPrivate\nKey\nHere\n-----END PRIVATE KEY-----\n"

# Firebase Client Config (REQUIRED for web auth)
FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
```

**How to get:**
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Project Settings → Service Accounts → Generate New Private Key
3. Extract values from downloaded JSON file

### Supabase (Postgres for Messages)

```bash
# Supabase Postgres connection string (REQUIRED)
SUPABASE_DB_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres

# Supabase API credentials (REQUIRED)
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**How to get:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Project Settings → Database → Connection String (Transaction mode)
3. Project Settings → API → Project URL & service_role key (keep secret!)

### Email (Brevo/SendInBlue)

```bash
# Brevo API key (REQUIRED for password reset, reports)
BREVO_API_KEY=xkeysib-your-api-key-here

# Email queue settings (optional, defaults shown)
BREVO_EMAIL_QUEUE_CONCURRENCY=5
BREVO_EMAIL_QUEUE_MAX_PENDING=500
```

**How to get:**
1. Go to [Brevo Dashboard](https://app.brevo.com)
2. Account → SMTP & API → API Keys → Create new API key

### Push Notifications (VAPID for Web Push)

```bash
# VAPID keys for web push notifications (REQUIRED for web push)
# Generate with: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=BNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VAPID_PRIVATE_KEY=your-private-key-here
```

**How to generate:**
```bash
cd dating-app
npx web-push generate-vapid-keys
```

## Optional: Performance & Monitoring

### Redis (Session Store & Rate Limiting)

```bash
# Redis URL (optional, falls back to local memory store)
REDIS_URL=redis://default:password@redis-host:6379

# Enable Redis-backed caching (optional, default: false)
REDIS_CACHE_ENABLED=true
```

**When to use:**
- Multi-instance deployments (Railway auto-scaling)
- Improved rate limiting across instances
- Persistent sessions across deployments

**How to add:**
1. Railway: Add Redis service → Copy connection URL
2. Set `REDIS_URL` environment variable

### Sentry (Error Tracking)

```bash
# Sentry DSN for crash monitoring (REQUIRED for production visibility)
SENTRY_DSN=https://[key]@[org].ingest.sentry.io/[project-id]
```

**See:** [SENTRY_SETUP.md](./SENTRY_SETUP.md)

### Logging

```bash
# Log level (default: info)
LOG_LEVEL=info  # Options: trace, debug, info, warn, error, fatal

# Node environment
NODE_ENV=production
```

## Environment Variable Checklist

Use this checklist before deploying to production:

- [ ] `SESSION_SECRET` — 64-character random hex string
- [ ] `FIREBASE_PROJECT_ID` — Your Firebase project ID
- [ ] `FIREBASE_CLIENT_EMAIL` — Firebase Admin SDK email
- [ ] `FIREBASE_PRIVATE_KEY` — Firebase Admin SDK private key (with \n escaped)
- [ ] `FIREBASE_API_KEY` — Firebase web API key
- [ ] `SUPABASE_DB_URL` — Postgres connection string
- [ ] `SUPABASE_URL` — Supabase project URL
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key
- [ ] `BREVO_API_KEY` — Brevo/SendInBlue API key
- [ ] `VAPID_PUBLIC_KEY` — Web push public key
- [ ] `VAPID_PRIVATE_KEY` — Web push private key
- [ ] `SENTRY_DSN` — Sentry crash monitoring DSN (highly recommended)
- [ ] `REDIS_URL` — Redis connection (recommended for multi-instance)

## Setting Variables in Railway

1. Go to Railway dashboard → Your project
2. Click on your service
3. Go to "Variables" tab
4. Add each variable with its value
5. Railway will auto-restart the service after changes

## Verifying Configuration

After setting environment variables, verify they're loaded:

```bash
# Check health endpoint
curl https://your-app.railway.app/health/ready

# Should return 200 OK with:
{
  "status": "healthy",
  "timestamp": "...",
  "checks": {
    "firestore": "ok",
    "supabase": "ok",
    "redis": "ok" or "unavailable"
  }
}
```

## Security Notes

⚠️ **Never commit environment variables to git**
⚠️ **Never log or expose `SESSION_SECRET`, `FIREBASE_PRIVATE_KEY`, or API keys**
⚠️ **Rotate `SESSION_SECRET` if compromised (invalidates all sessions)**
⚠️ **Use Railway's encrypted variable storage for production**

## Local Development

For local development, create a `.env` file in `dating-app/` directory:

```bash
# .env (DO NOT COMMIT)
SESSION_SECRET=local-dev-secret-not-for-production
FIREBASE_PROJECT_ID=your-dev-project
# ... other variables
```

Load with:
```bash
npm install dotenv
# Add to top of server.js: require('dotenv').config();
```

**Note:** `.env` is already in `.gitignore` to prevent accidental commits.
