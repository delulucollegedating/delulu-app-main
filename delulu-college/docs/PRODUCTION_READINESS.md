# Production Readiness Checklist

This checklist ensures Delulu is production-ready before inviting users.

## ✅ Completed Items

### Legal & Policy Pages
- [x] Privacy policy ([privacy.html](/dating-app/public/privacy.html))
- [x] Terms of service ([terms.html](/dating-app/public/terms.html))
- [x] Support/contact page ([support.html](/dating-app/public/support.html))
- [x] Account deletion flow ([delete-account.html](/dating-app/public/delete-account.html))

### Security & Build
- [x] Release build signing configured ([build.gradle:46](/dating-app/android/app/build.gradle:46))
  - Fails build if release keystore missing (prevents debug signing accidents)
- [x] Dependency vulnerability audit in CI ([ci.yml](/dating-app/.github/workflows/ci.yml))
  - Runs `npm audit` and `audit-ci` before tests

### Documentation
- [x] Environment variables documented ([ENVIRONMENT_VARIABLES.md](/dating-app/docs/ENVIRONMENT_VARIABLES.md))
- [x] Sentry setup guide ([SENTRY_SETUP.md](/dating-app/docs/SENTRY_SETUP.md))

## ⚠️ Required Before Production Launch

### 1. Enable Crash Monitoring

**Status:** 🔴 **DISABLED** — Line 18 of [sentry-init.js](/dating-app/public/js/sentry-init.js) has `SENTRY_DSN = null`

**Action Required:**
1. Create Sentry account at [sentry.io](https://sentry.io)
2. Get your DSN (looks like `https://[key]@[org].ingest.sentry.io/[project-id]`)
3. Update line 18 of `sentry-init.js`:
   ```javascript
   var SENTRY_DSN = 'https://YOUR_ACTUAL_DSN_HERE@...';
   ```
4. **OR** set Railway environment variable `SENTRY_DSN` and modify build to inject it

**Why critical:** Without Sentry, crashes and ANRs are invisible. You won't know when users hit errors.

**See:** [SENTRY_SETUP.md](/dating-app/docs/SENTRY_SETUP.md)

### 2. Verify Production Environment Variables

**Action Required:**
Check Railway dashboard has ALL required variables set:

```bash
# Critical variables that MUST be set:
✓ SESSION_SECRET (64-char hex)
✓ FIREBASE_PROJECT_ID
✓ FIREBASE_CLIENT_EMAIL
✓ FIREBASE_PRIVATE_KEY
✓ FIREBASE_API_KEY
✓ SUPABASE_DB_URL
✓ SUPABASE_URL
✓ SUPABASE_SERVICE_ROLE_KEY
✓ BREVO_API_KEY
✓ VAPID_PUBLIC_KEY
✓ VAPID_PRIVATE_KEY

# Highly recommended:
✓ SENTRY_DSN
✓ REDIS_URL (for multi-instance deployments)
```

**How to verify:**
1. Go to Railway → Your Project → Service → Variables tab
2. Check each variable is set and not placeholder text
3. Test endpoints after setting (see section 3 below)

**See:** [ENVIRONMENT_VARIABLES.md](/dating-app/docs/ENVIRONMENT_VARIABLES.md)

### 3. Verify Health Endpoint Returns 200

**Status:** 🟡 **NEEDS VERIFICATION** — Health check was returning 503 before your local fix

**Action Required:**
After deploying with all environment variables set, test the health endpoint:

```bash
# Replace with your actual Railway URL
curl -v https://your-app.railway.app/health/ready
```

**Expected response (200 OK):**
```json
{
  "ready": true,
  "status": "healthy",
  "timestamp": "2026-08-30T...",
  "uptime": 123.456,
  "responseTime": 45,
  "dependencies": {
    "firestore": { "status": "ok", "message": "Connected" },
    "supabase": { "status": "ok", "message": "Connected" },
    "redis": { "status": "ok", "message": "Connected" }
  },
  "circuitBreakers": {
    "brevoBreaker": { "state": "CLOSED", ... },
    "pushBreaker": { "state": "CLOSED", ... }
  }
}
```

**If you get 503 Service Unavailable:**
- Check `dependencies` section for errors
- Common issues:
  - Firestore: `FIREBASE_*` variables incorrect or private key malformed
  - Supabase: `SUPABASE_DB_URL` wrong or network blocked
  - Redis: `REDIS_URL` wrong (can be warning, not error)

**Health endpoint checks:**
- Firestore connection (users, connections)
- Supabase Postgres connection (messages, receipts)
- Redis connection (optional, falls back to memory)
- Circuit breaker states (Brevo email, push notifications)

**Implementation:** [healthCheck.js](/dating-app/utils/healthCheck.js)

### 4. Generate and Secure Release Keystore

**Status:** 🟡 **BUILD WILL FAIL** until keystore is generated

**Action Required:**
```bash
cd dating-app/android
mkdir -p keystore

# Generate release keystore (DO THIS ONCE, KEEP IT FOREVER)
keytool -genkey -v -keystore keystore/delulu-release.keystore \
  -alias delulu \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# You'll be prompted for:
# - Keystore password (SAVE THIS)
# - Key password (can be same as keystore password)
# - Name, organization, etc. (use real values)
```

**Set Railway environment variables:**
```bash
RELEASE_STORE_PASSWORD=your_keystore_password
RELEASE_KEY_ALIAS=delulu
RELEASE_KEY_PASSWORD=your_key_password  # or same as RELEASE_STORE_PASSWORD
```

**⚠️ CRITICAL: Backup the keystore file!**
- Upload `keystore/delulu-release.keystore` to a secure location (1Password, AWS S3, etc.)
- If you lose this file, users CANNOT update the app (must uninstall/reinstall)
- **Never commit to git** — `.gitignore` already excludes `keystore/`

**Why this matters:**
- Android requires all updates be signed with the same certificate
- If you accidentally release with debug signing, you're locked into that certificate
- The [build.gradle:46-60](/dating-app/android/app/build.gradle:46) now fails build if keystore is missing

### 5. Test Real User Flows

**Action Required:**
Before inviting beta users, test these flows end-to-end on production:

1. **Signup Flow:**
   - [ ] Create account with email/password
   - [ ] Receive welcome email (check Brevo sent logs)
   - [ ] Email verification works (if implemented)

2. **Push Notifications:**
   - [ ] Android: FCM push arrives on device
   - [ ] Web: Browser push notification works
   - [ ] Check Firebase Console → Cloud Messaging for delivery logs

3. **Chat Flow:**
   - [ ] Send message between two accounts
   - [ ] Real-time delivery works (SSE streams)
   - [ ] Read receipts update correctly
   - [ ] Messages persist after app restart

4. **Discovery & Matching:**
   - [ ] Users appear in discovery (ecosystem filtering works)
   - [ ] Icebreaker questions load
   - [ ] Connection creation works
   - [ ] Identity/face reveal timelines work (Day 7/10)

5. **Account Deletion:**
   - [ ] Visit [/delete-account.html](/dating-app/public/delete-account.html)
   - [ ] Enter password confirmation
   - [ ] Account and data fully deleted
   - [ ] Redirects to [/goodbye.html](/dating-app/public/goodbye.html)

6. **Error Scenarios:**
   - [ ] Trigger an error (e.g., invalid API call)
   - [ ] Check Sentry dashboard for error report
   - [ ] Verify no PII leaked in error logs

## Go/No-Go Decision

### ✅ Safe to Invite Small Supervised Beta:
- [x] All policy pages live
- [x] Account deletion works
- [x] Release signing configured
- [ ] `/health/ready` returns 200 ✅
- [ ] Sentry configured and receiving test errors
- [ ] Real signup/push/chat flows verified

### ⛔ NOT READY for Public Rollout until:
- [ ] All above items checked ✅
- [ ] Beta tested with 10-20 users for 1 week
- [ ] No critical bugs reported
- [ ] Firebase Crashlytics shows no crashes
- [ ] Sentry dashboard clean (or known issues documented)

## Post-Launch Monitoring

Once live, monitor these daily:

1. **Sentry Dashboard:** [sentry.io](https://sentry.io)
   - New errors/crashes
   - Sudden spike in error rate

2. **Firebase Console:** [console.firebase.google.com](https://console.firebase.google.com)
   - Crashlytics → Crash-free users %
   - Cloud Messaging → Delivery success rate

3. **Railway Metrics:**
   - CPU/Memory usage
   - Response times
   - Error rate

4. **Health Endpoint:**
   ```bash
   # Run daily or set up monitoring (e.g., UptimeRobot)
   curl https://your-app.railway.app/health/ready
   ```

5. **User Support:**
   - Check [support.html](/dating-app/public/support.html) email inbox
   - Respond to reports within 24 hours

## Recommended: Additional Production Hardening

These are not blockers but highly recommended:

- [ ] Set up automated uptime monitoring (UptimeRobot, Pingdom)
- [ ] Configure Railway auto-scaling for traffic spikes
- [ ] Add rate limiting alerts (Sentry or custom)
- [ ] Set up database backups (Firestore auto-backs up, verify Supabase)
- [ ] Document incident response plan
- [ ] Create runbook for common issues

## Quick Verification Script

Run this after deploying to production:

```bash
#!/bin/bash
# verify-production.sh

PROD_URL="https://your-app.railway.app"

echo "🔍 Verifying production deployment..."

# 1. Health check
echo -n "Health endpoint: "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL/health/ready")
if [ "$STATUS" = "200" ]; then
  echo "✅ OK ($STATUS)"
else
  echo "❌ FAILED ($STATUS)"
  curl -s "$PROD_URL/health/ready" | jq .
fi

# 2. Policy pages
for page in privacy terms support delete-account; do
  echo -n "/$page.html: "
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL/$page.html")
  if [ "$STATUS" = "200" ]; then
    echo "✅ OK"
  else
    echo "❌ FAILED ($STATUS)"
  fi
done

# 3. API responds
echo -n "/api/icebreakers: "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL/api/icebreakers")
if [ "$STATUS" = "200" ] || [ "$STATUS" = "401" ]; then
  echo "✅ OK ($STATUS - needs auth)"
else
  echo "❌ FAILED ($STATUS)"
fi

echo ""
echo "Done! Check all ✅ before inviting users."
```

Save as `verify-production.sh`, make executable (`chmod +x`), and run after each deploy.
