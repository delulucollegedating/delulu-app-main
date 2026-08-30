#!/bin/bash
# Pre-Launch Verification Script for Delulu
#
# Checks the three critical launch gaps:
# 1. Sentry crash monitoring configured
# 2. Release keystore exists and is valid
# 3. Production environment variables set

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Delulu Pre-Launch Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# Helper functions
pass() {
  echo "  ✅ $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "  ❌ $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn() {
  echo "  ⚠️  $1"
  WARN_COUNT=$((WARN_COUNT + 1))
}

info() {
  echo "     $1"
}

section() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "$1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Gap 1: Sentry Configuration
section "Gap 1: Crash Monitoring (Sentry)"

SENTRY_INIT="$PROJECT_ROOT/public/js/sentry-init.js"
if [ ! -f "$SENTRY_INIT" ]; then
  fail "sentry-init.js not found"
else
  # Check if DSN is configured (either hardcoded or via env var check)
  if grep -q "SENTRY_DSN = null; // Replace with:" "$SENTRY_INIT"; then
    if [ -z "$SENTRY_DSN" ]; then
      fail "Sentry DSN not configured (hardcoded null and no env var)"
      info "Fix: Set SENTRY_DSN environment variable or edit sentry-init.js:28"
    else
      pass "Sentry DSN configured via environment variable"
    fi
  else
    pass "Sentry DSN hardcoded in sentry-init.js"
  fi

  # Check if window.__SENTRY_DSN__ injection is present
  if grep -q "window.__SENTRY_DSN__" "$SENTRY_INIT"; then
    pass "Sentry supports environment variable injection"
  else
    warn "Sentry does not check window.__SENTRY_DSN__ (old version)"
  fi
fi

# Gap 2: Release Keystore
section "Gap 2: Release Keystore"

KEYSTORE_FILE="$PROJECT_ROOT/android/keystore/delulu-release.keystore"
if [ ! -f "$KEYSTORE_FILE" ]; then
  fail "Release keystore not found"
  info "Location: $KEYSTORE_FILE"
  info "Fix: Run ./scripts/generate-keystore.sh"
else
  pass "Release keystore exists"
  info "Location: $KEYSTORE_FILE"

  # Check keystore validity
  if command -v keytool &> /dev/null; then
    KEYSTORE_INFO=$(keytool -list -v -keystore "$KEYSTORE_FILE" -storepass android 2>/dev/null || echo "")
    if echo "$KEYSTORE_INFO" | grep -q "Alias name: delulu"; then
      pass "Keystore alias 'delulu' found"
    else
      warn "Could not verify keystore alias (password-protected)"
      info "Verify manually: keytool -list -keystore $KEYSTORE_FILE"
    fi
  else
    warn "keytool not found - cannot verify keystore"
  fi

  # Check if build.gradle is configured
  BUILD_GRADLE="$PROJECT_ROOT/android/app/build.gradle"
  if grep -q "RELEASE_STORE_PASSWORD" "$BUILD_GRADLE"; then
    pass "build.gradle configured for release signing"
  else
    fail "build.gradle not configured for release signing"
    info "Expected to find RELEASE_STORE_PASSWORD in build.gradle"
  fi
fi

# Gap 3: Environment Variables
section "Gap 3: Production Environment Variables"

REQUIRED_VARS=(
  "SESSION_SECRET"
  "FIREBASE_PROJECT_ID"
  "FIREBASE_CLIENT_EMAIL"
  "FIREBASE_PRIVATE_KEY"
  "FIREBASE_API_KEY"
  "SUPABASE_DB_URL"
  "SUPABASE_URL"
  "SUPABASE_SERVICE_ROLE_KEY"
  "BREVO_API_KEY"
  "VAPID_PUBLIC_KEY"
  "VAPID_PRIVATE_KEY"
)

OPTIONAL_VARS=(
  "SENTRY_DSN"
  "REDIS_URL"
)

echo ""
echo "Checking local environment (development):"
echo ""

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    warn "$var not set (required for production)"
  else
    pass "$var set"
  fi
done

echo ""
echo "Optional variables:"
echo ""

for var in "${OPTIONAL_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    info "$var not set (recommended for production)"
  else
    pass "$var set"
  fi
done

echo ""
info "Note: These checks only verify local environment."
info "For Railway deployment, verify in Railway Dashboard → Variables tab"

# Production URL check (if provided)
section "Production Deployment Check"

if [ -z "$1" ]; then
  warn "No production URL provided - skipping live checks"
  info "Usage: $0 https://your-app.railway.app"
else
  PROD_URL="$1"
  echo ""
  echo "Production URL: $PROD_URL"
  echo ""

  # Health check
  echo -n "Checking /health/ready... "
  HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL/health/ready" 2>/dev/null || echo "000")

  if [ "$HEALTH_STATUS" = "200" ]; then
    pass "Health endpoint OK (200)"

    # Get detailed health info
    HEALTH_JSON=$(curl -s "$PROD_URL/health/ready" 2>/dev/null)

    if command -v jq &> /dev/null; then
      echo ""
      echo "Dependencies:"
      echo "$HEALTH_JSON" | jq -r '.dependencies | to_entries[] | "  \(.key): \(.value.status)"'
    fi
  else
    fail "Health endpoint failed ($HEALTH_STATUS)"
    info "Expected 200, got $HEALTH_STATUS"
    if [ "$HEALTH_STATUS" = "503" ]; then
      info "503 = Service Unavailable - check dependencies (Firestore, Supabase, Redis)"
    fi
  fi

  # Policy pages
  echo ""
  echo "Checking policy pages:"
  for page in privacy terms support delete-account; do
    echo -n "  /$page.html... "
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL/$page.html" 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ]; then
      echo "✅"
    else
      echo "❌ $STATUS"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  done
fi

# Summary
section "Summary"
echo ""
echo "  ✅ Passed:  $PASS_COUNT"
echo "  ❌ Failed:  $FAIL_COUNT"
echo "  ⚠️  Warnings: $WARN_COUNT"
echo ""

if [ $FAIL_COUNT -gt 0 ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "⛔ NOT READY FOR PRODUCTION"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Fix the failed checks above before launching."
  echo ""
  echo "See LAUNCH_GAPS.md for detailed instructions."
  exit 1
elif [ $WARN_COUNT -gt 0 ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "⚠️  READY FOR BETA (with warnings)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Safe for small supervised beta testing."
  echo "Address warnings before public rollout."
  exit 0
else
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ ALL CHECKS PASSED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Ready for production launch!"
  echo ""
  echo "Next: Complete manual device testing checklist in LAUNCH_GAPS.md"
  exit 0
fi
