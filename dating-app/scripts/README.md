# Delulu Scripts

Automation scripts for deployment, keystore generation, and production verification.

## Available Scripts

### 🔑 generate-keystore.sh
Generate Android release keystore for APK signing.

**Usage:**
```bash
./scripts/generate-keystore.sh
```

**What it does:**
- Creates `android/keystore/delulu-release.keystore`
- Prompts for keystore password (save in 1Password!)
- Validates keystore doesn't already exist (prevents accidents)
- Provides next steps for Railway environment variables

**⚠️ CRITICAL:** Run this ONCE and backup the keystore file. If lost, users cannot update the app.

---

### ✅ verify-launch-readiness.sh
Pre-launch verification for the three critical gaps.

**Usage:**
```bash
# Local verification only
./scripts/verify-launch-readiness.sh

# Full verification with production URL
./scripts/verify-launch-readiness.sh https://your-app.railway.app
```

**What it checks:**
1. **Gap 1:** Sentry DSN configured (crash monitoring)
2. **Gap 2:** Release keystore exists and is valid
3. **Gap 3:** Environment variables set
4. **Production:** Health endpoint, policy pages (if URL provided)

**Exit codes:**
- `0` = All checks passed, ready for production
- `1` = Failed checks, NOT ready for production

---

### 🔧 generate:profanity (npm script)
Regenerate client-side profanity filter.

**Usage:**
```bash
npm run generate:profanity
```

**What it does:**
- Reads `profanity-list.txt`
- Generates optimized regex in `public/js/profanity-check.js`
- Used by client-side validation before API calls

---

## Quick Reference

### First-Time Setup
```bash
# 1. Generate release keystore
./scripts/generate-keystore.sh

# 2. Verify everything is ready
./scripts/verify-launch-readiness.sh
```

### Before Each Deploy
```bash
# Run verification with production URL
./scripts/verify-launch-readiness.sh https://your-app.railway.app

# Should see:
# ✅ ALL CHECKS PASSED
# Ready for production launch!
```

### Building Release APK
```bash
# After keystore is generated and Railway env vars are set
cd dating-app
npx cap sync android
cd android
./gradlew assembleRelease

# APK location:
# app/build/outputs/apk/release/app-release.apk
```

### Verifying APK Signature
```bash
keytool -printcert -jarfile android/app/build/outputs/apk/release/app-release.apk

# Should show:
# Owner: CN=Delulu, OU=..., O=Your Company
# NOT: CN=Android Debug
```

---

## Environment Variables Required

See [../docs/ENVIRONMENT_VARIABLES.md](../docs/ENVIRONMENT_VARIABLES.md) for full list.

**Critical:**
- `SESSION_SECRET`
- `FIREBASE_*` (5 variables)
- `SUPABASE_*` (3 variables)
- `BREVO_API_KEY`
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`

**Highly Recommended:**
- `SENTRY_DSN` (crash monitoring)
- `REDIS_URL` (multi-instance deployments)

**For Release Builds:**
- `RELEASE_STORE_PASSWORD`
- `RELEASE_KEY_ALIAS=delulu`
- `RELEASE_KEY_PASSWORD`

---

## Troubleshooting

### "Keystore already exists"
Keystore generation is a one-time operation. If you need a new keystore:
1. **Backup existing keystore first**
2. Delete: `rm android/keystore/delulu-release.keystore`
3. Run `./scripts/generate-keystore.sh` again

⚠️ **WARNING:** New keystore = existing APKs cannot be updated.

### "keytool not found"
Install Java JDK:
```bash
# macOS
brew install openjdk

# Ubuntu
sudo apt install default-jdk
```

### Verification script fails with "Health endpoint failed (503)"
Check Railway environment variables:
1. Go to Railway Dashboard → Your Service → Variables
2. Verify all required variables are set (not placeholder text)
3. Check `/health/ready` response for specific dependency errors

### APK still signed with "CN=Android Debug"
Ensure Railway environment variables are set:
- `RELEASE_STORE_PASSWORD`
- `RELEASE_KEY_ALIAS=delulu`
- `RELEASE_KEY_PASSWORD`

The `build.gradle` will fail if keystore is missing (safety check).

---

## Related Documentation

- [LAUNCH_GAPS.md](../LAUNCH_GAPS.md) - Pre-launch critical gaps
- [docs/ENVIRONMENT_VARIABLES.md](../docs/ENVIRONMENT_VARIABLES.md) - All env vars
- [docs/SENTRY_SETUP.md](../docs/SENTRY_SETUP.md) - Sentry configuration
- [docs/PRODUCTION_READINESS.md](../docs/PRODUCTION_READINESS.md) - Full checklist
- [APK_BUILD_GUIDE.md](../APK_BUILD_GUIDE.md) - APK build instructions (if exists)
