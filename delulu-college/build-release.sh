#!/bin/bash
# Delulu Release Build Script
# This script builds a properly-signed release APK/AAB for production

set -e  # Exit on error

echo "🚀 Delulu Release Build Script"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -f "android/app/build.gradle" ]; then
    echo "❌ Error: Must run from delulu-college/ directory"
    exit 1
fi

# Check for release keystore
if [ ! -f "android/keystore/delulu-release.keystore" ]; then
    echo "❌ Error: Release keystore not found at android/keystore/delulu-release.keystore"
    echo "   Generate one with: keytool -genkey -v -keystore android/keystore/delulu-release.keystore -alias delulu -keyalg RSA -keysize 2048 -validity 10000"
    exit 1
fi

# Check environment variables
if [ -z "$RELEASE_STORE_PASSWORD" ]; then
    echo "⚠️  RELEASE_STORE_PASSWORD not set"
    read -sp "Enter keystore password: " RELEASE_STORE_PASSWORD
    echo ""
    export RELEASE_STORE_PASSWORD
fi

if [ -z "$RELEASE_KEY_ALIAS" ]; then
    export RELEASE_KEY_ALIAS="delulu"
    echo "✓ Using default key alias: delulu"
fi

if [ -z "$RELEASE_KEY_PASSWORD" ]; then
    echo "⚠️  RELEASE_KEY_PASSWORD not set, using same as store password"
    export RELEASE_KEY_PASSWORD="$RELEASE_STORE_PASSWORD"
fi

echo ""
echo "✓ Release keystore found"
echo "✓ Environment variables set"
echo ""

# Ask what to build
echo "What do you want to build?"
echo "  1) AAB (Android App Bundle) - for Play Store [Recommended]"
echo "  2) APK - for direct distribution"
read -p "Enter choice (1 or 2): " choice

echo ""
echo "📦 Syncing Capacitor assets..."
npx cap sync android

echo ""
echo "🔨 Building release..."
cd android

if [ "$choice" = "1" ]; then
    echo "Building AAB for Play Store..."
    ./gradlew clean bundleRelease
    BUILD_OUTPUT="android/app/build/outputs/bundle/release/app-release.aab"
else
    echo "Building APK for direct distribution..."
    ./gradlew clean assembleRelease
    BUILD_OUTPUT="android/app/build/outputs/apk/release/app-release.apk"
fi

cd ..

echo ""
echo "✅ Build successful!"
echo ""
echo "📁 Output: $BUILD_OUTPUT"
echo "📊 Size: $(du -h "$BUILD_OUTPUT" | cut -f1)"
echo ""

# Verify signing
echo "🔍 Verifying signature..."
if jarsigner -verify -verbose "$BUILD_OUTPUT" 2>&1 | grep -q "jar verified"; then
    echo "✅ Signature verified!"

    # Show certificate info
    echo ""
    echo "📜 Certificate info:"
    jarsigner -verify -verbose -certs "$BUILD_OUTPUT" 2>&1 | grep -A 3 "Signed by"

    # Check if it's debug cert (should NOT be)
    if jarsigner -verify -verbose -certs "$BUILD_OUTPUT" 2>&1 | grep -q "Android Debug"; then
        echo ""
        echo "⛔ ERROR: Signed with DEBUG certificate!"
        echo "   This APK/AAB cannot be uploaded to Play Store."
        echo "   Make sure RELEASE_STORE_PASSWORD is set correctly."
        exit 1
    else
        echo ""
        echo "✅ Signed with RELEASE certificate - ready for distribution!"
    fi
else
    echo "❌ Signature verification failed!"
    exit 1
fi

echo ""
echo "🎉 Release build complete and verified!"
echo ""

if [ "$choice" = "1" ]; then
    echo "Next steps:"
    echo "  1. Go to https://play.google.com/console"
    echo "  2. Select your app"
    echo "  3. Production → Create new release"
    echo "  4. Upload: $BUILD_OUTPUT"
else
    echo "Next steps:"
    echo "  1. Test on device: adb install -r $BUILD_OUTPUT"
    echo "  2. Test notifications, login, chat"
    echo "  3. Distribute to users"
fi

echo ""
