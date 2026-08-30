#!/bin/bash
# Generate Android Release Keystore for Delulu
#
# This script generates a release keystore for signing Android APKs.
# Run this ONCE and backup the generated keystore file securely.
#
# ⚠️  CRITICAL: If you lose this keystore, users cannot update the app.
#               They must uninstall and reinstall, losing all data.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYSTORE_DIR="$PROJECT_ROOT/android/keystore"
KEYSTORE_FILE="$KEYSTORE_DIR/delulu-release.keystore"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Delulu Android Release Keystore Generator"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if keystore already exists
if [ -f "$KEYSTORE_FILE" ]; then
  echo "⚠️  ERROR: Keystore already exists at:"
  echo "    $KEYSTORE_FILE"
  echo ""
  echo "If you want to generate a new keystore (NOT RECOMMENDED):"
  echo "  1. Backup the existing keystore first"
  echo "  2. Delete the existing keystore: rm '$KEYSTORE_FILE'"
  echo "  3. Run this script again"
  echo ""
  echo "⚠️  WARNING: Generating a new keystore means existing APKs"
  echo "            cannot be updated - users must uninstall/reinstall."
  exit 1
fi

# Create keystore directory
mkdir -p "$KEYSTORE_DIR"

echo "This script will generate a release keystore for signing Android APKs."
echo ""
echo "⚠️  IMPORTANT: You will be asked for passwords and information."
echo "              SAVE ALL PASSWORDS in 1Password or similar vault."
echo ""
echo "Location: $KEYSTORE_FILE"
echo "Alias: delulu"
echo "Validity: 10,000 days (~27 years)"
echo ""
read -p "Press ENTER to continue or Ctrl+C to cancel..."
echo ""

# Check if keytool is available
if ! command -v keytool &> /dev/null; then
  echo "❌ ERROR: keytool not found. Please install Java JDK."
  echo ""
  echo "Install via:"
  echo "  macOS:   brew install openjdk"
  echo "  Ubuntu:  sudo apt install default-jdk"
  echo ""
  exit 1
fi

# Generate keystore
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Generating keystore..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "You will be prompted for:"
echo "  1. Keystore password (SAVE THIS)"
echo "  2. Key password (use same as keystore password)"
echo "  3. Organization info (use real values)"
echo ""

keytool -genkey -v \
  -keystore "$KEYSTORE_FILE" \
  -alias delulu \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Keystore generation failed."
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Keystore generated successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Keystore location:"
echo "  $KEYSTORE_FILE"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NEXT STEPS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. 🔒 BACKUP THE KEYSTORE (CRITICAL)"
echo "   Upload to secure storage:"
echo "   - 1Password secure vault"
echo "   - AWS S3 private bucket"
echo "   - Encrypted USB drive in safe"
echo ""
echo "   ⚠️  If you lose this file, users CANNOT update the app!"
echo ""
echo "2. 📝 SAVE THESE VALUES IN 1PASSWORD:"
echo "   File: $KEYSTORE_FILE"
echo "   Alias: delulu"
echo "   Keystore Password: [the password you just entered]"
echo "   Key Password: [the password you just entered]"
echo ""
echo "3. 🚀 SET RAILWAY ENVIRONMENT VARIABLES:"
echo "   Go to: Railway Dashboard → Your Service → Variables"
echo ""
echo "   Add these variables:"
echo "   RELEASE_STORE_PASSWORD=your_keystore_password"
echo "   RELEASE_KEY_ALIAS=delulu"
echo "   RELEASE_KEY_PASSWORD=your_key_password"
echo ""
echo "4. 🔨 BUILD RELEASE APK:"
echo "   cd $PROJECT_ROOT"
echo "   npx cap sync android"
echo "   cd android"
echo "   ./gradlew assembleRelease"
echo ""
echo "   APK will be at:"
echo "   android/app/build/outputs/apk/release/app-release.apk"
echo ""
echo "5. ✅ VERIFY SIGNATURE:"
echo "   keytool -printcert -jarfile android/app/build/outputs/apk/release/app-release.apk"
echo ""
echo "   Should show:"
echo "   Owner: CN=Delulu, OU=..., O=Your Company"
echo "   NOT: CN=Android Debug"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  SECURITY REMINDERS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ✓ Keystore is in .gitignore (never commit to git)"
echo "  ✓ Backup keystore to multiple secure locations"
echo "  ✓ Save passwords in password manager (1Password, etc.)"
echo "  ✓ Do NOT share keystore with untrusted parties"
echo "  ✓ If compromised, you cannot revoke it - must create new app"
echo ""
