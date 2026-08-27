#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Generate a release keystore for Delulu Android APK signing
#
# Usage:
#   bash scripts/generate-release-keystore.sh              # random 16-char password
#   bash scripts/generate-release-keystore.sh MyStr0ngPw!  # explicit password
#
# After running, add the printed env vars to:
#   - Railway: Settings → Variables
#   - Local:   .env file
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

KEYSTORE_DIR="android/keystore"
KEYSTORE_FILE="$KEYSTORE_DIR/delulu-release.keystore"
ALIAS="delulu"

if [ -f "$KEYSTORE_FILE" ]; then
  echo "⚠️  Keystore already exists at: $KEYSTORE_FILE"
  echo "   Delete it first if you want to regenerate."
  exit 1
fi

# Use provided password or generate a random one
if [ -n "${1:-}" ]; then
  PASSWORD="$1"
else
  PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
fi

mkdir -p "$KEYSTORE_DIR"

keytool -genkeypair \
  -v \
  -keystore "$KEYSTORE_FILE" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias "$ALIAS" \
  -storepass "$PASSWORD" \
  -keypass "$PASSWORD" \
  -dname "CN=Delulu, OU=College, O=Delulu, L=Bangalore, ST=Karnataka, C=IN"

echo ""
echo "✅ Keystore created: $KEYSTORE_FILE"
echo ""
echo "Add these environment variables:"
echo "  RELEASE_STORE_PASSWORD=$PASSWORD"
echo "  RELEASE_KEY_ALIAS=$ALIAS"
echo "  RELEASE_KEY_PASSWORD=$PASSWORD"
echo ""
echo "🔑 Save this password somewhere safe — you'll need it for every release."
