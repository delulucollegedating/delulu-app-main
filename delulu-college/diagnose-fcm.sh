#!/bin/bash
# Comprehensive FCM Notification Diagnostic Script

echo "════════════════════════════════════════════════════════════"
echo "  Delulu FCM Notification Diagnostic"
echo "════════════════════════════════════════════════════════════"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
info() { echo -e "${BLUE}ℹ${NC} $1"; }

echo "1️⃣  CHECKING BUILD CONFIGURATION"
echo "────────────────────────────────────────────────────────────"

# Check google-services.json exists
if [ -f "android/app/google-services.json" ]; then
    pass "google-services.json exists"

    # Check if it has the correct package name
    PACKAGE_COUNT=$(grep -c '"package_name": "com.delulu.college.app"' android/app/google-services.json)
    if [ "$PACKAGE_COUNT" -gt 0 ]; then
        pass "google-services.json contains com.delulu.college.app"
    else
        fail "google-services.json does NOT contain com.delulu.college.app"
        echo "     Your APK will NOT receive notifications!"
    fi

    # Show all package names in the file
    info "Package names in google-services.json:"
    grep '"package_name"' android/app/google-services.json | sed 's/.*: "//;s/".*//' | sed 's/^/     /'
else
    fail "google-services.json NOT FOUND at android/app/google-services.json"
fi

echo ""
echo "2️⃣  CHECKING ANDROID MANIFEST"
echo "────────────────────────────────────────────────────────────"

if [ -f "android/app/src/main/AndroidManifest.xml" ]; then
    pass "AndroidManifest.xml exists"

    # Check for DeluluMessagingService
    if grep -q "DeluluMessagingService" android/app/src/main/AndroidManifest.xml; then
        pass "DeluluMessagingService registered in manifest"
    else
        fail "DeluluMessagingService NOT found in manifest"
    fi

    # Check for POST_NOTIFICATIONS permission
    if grep -q "POST_NOTIFICATIONS" android/app/src/main/AndroidManifest.xml; then
        pass "POST_NOTIFICATIONS permission declared"
    else
        warn "POST_NOTIFICATIONS permission NOT declared (required for Android 13+)"
    fi

    # Check for notification channel metadata
    if grep -q "default_notification_channel_id" android/app/src/main/AndroidManifest.xml; then
        pass "Default notification channel configured"
    else
        warn "Default notification channel NOT configured"
    fi
else
    fail "AndroidManifest.xml NOT FOUND"
fi

echo ""
echo "3️⃣  CHECKING MESSAGING SERVICE IMPLEMENTATION"
echo "────────────────────────────────────────────────────────────"

if [ -f "android/app/src/main/java/com/delulu/college/app/DeluluMessagingService.java" ]; then
    pass "DeluluMessagingService.java exists"

    # Check for critical methods
    if grep -q "onMessageReceived" android/app/src/main/java/com/delulu/college/app/DeluluMessagingService.java; then
        pass "onMessageReceived() method implemented"
    else
        fail "onMessageReceived() method NOT found"
    fi

    if grep -q "showSystemNotification" android/app/src/main/java/com/delulu/college/app/DeluluMessagingService.java; then
        pass "showSystemNotification() method implemented"
    else
        fail "showSystemNotification() method NOT found"
    fi
else
    fail "DeluluMessagingService.java NOT FOUND"
fi

echo ""
echo "4️⃣  CHECKING BUILD.GRADLE CONFIGURATION"
echo "────────────────────────────────────────────────────────────"

if [ -f "android/app/build.gradle" ]; then
    pass "build.gradle exists"

    # Check package name
    if grep -q 'applicationId "com.delulu.college.app"' android/app/build.gradle; then
        pass "applicationId is com.delulu.college.app"
    else
        fail "applicationId is NOT com.delulu.college.app"
    fi

    # Check Firebase messaging dependency
    if grep -q "firebase-messaging" android/app/build.gradle; then
        pass "Firebase messaging dependency included"
        FIREBASE_VERSION=$(grep "firebase-messaging" android/app/build.gradle | sed 's/.*://;s/[^0-9.].*//')
        info "Firebase messaging version: $FIREBASE_VERSION"
    else
        fail "Firebase messaging dependency NOT found"
    fi

    # Check for google-services plugin
    if grep -q "com.google.gms.google-services" android/app/build.gradle; then
        pass "Google services plugin applied"
    else
        fail "Google services plugin NOT applied"
    fi
else
    fail "build.gradle NOT FOUND"
fi

echo ""
echo "5️⃣  CHECKING CLIENT-SIDE REGISTRATION CODE"
echo "────────────────────────────────────────────────────────────"

if [ -f "public/js/shared.js" ]; then
    pass "shared.js exists"

    if grep -q "initPushNotifications" public/js/shared.js; then
        pass "initPushNotifications() function exists"
    else
        fail "initPushNotifications() function NOT found"
    fi

    if grep -q "PushNotifications.register()" public/js/shared.js; then
        pass "PushNotifications.register() called"
    else
        fail "PushNotifications.register() NOT called"
    fi

    if grep -q "/api/devices/register" public/js/shared.js; then
        pass "Device registration API call present"
    else
        fail "Device registration API call NOT found"
    fi
else
    fail "shared.js NOT FOUND"
fi

echo ""
echo "6️⃣  CHECKING SERVER NOTIFICATION SENDING"
echo "────────────────────────────────────────────────────────────"

if [ -f "server.js" ]; then
    pass "server.js exists"

    if grep -q "sendPushNotification" server.js; then
        pass "sendPushNotification() function exists"
    else
        fail "sendPushNotification() function NOT found"
    fi

    if grep -q "firebase-admin/messaging" server.js; then
        pass "Firebase Admin SDK messaging imported"
    else
        fail "Firebase Admin SDK messaging NOT imported"
    fi

    if grep -q "getMessaging" server.js; then
        pass "getMessaging() used"
    else
        fail "getMessaging() NOT used"
    fi
else
    fail "server.js NOT FOUND"
fi

echo ""
echo "7️⃣  CHECKING APK BUILD STATUS"
echo "────────────────────────────────────────────────────────────"

if [ -f "android/app/build/outputs/apk/release/app-release.apk" ]; then
    APK_SIZE=$(ls -lh android/app/build/outputs/apk/release/app-release.apk | awk '{print $5}')
    APK_DATE=$(ls -l android/app/build/outputs/apk/release/app-release.apk | awk '{print $6, $7, $8}')
    pass "Release APK exists ($APK_SIZE, built $APK_DATE)"

    # Check if google-services.json is newer than APK
    if [ "android/app/google-services.json" -nt "android/app/build/outputs/apk/release/app-release.apk" ]; then
        warn "google-services.json is NEWER than APK - rebuild required!"
    fi

    # Check if DeluluMessagingService.java is newer than APK
    if [ "android/app/src/main/java/com/delulu/college/app/DeluluMessagingService.java" -nt "android/app/build/outputs/apk/release/app-release.apk" ]; then
        warn "DeluluMessagingService.java is NEWER than APK - rebuild required!"
    fi
else
    warn "Release APK not found - needs to be built"
fi

# Check if there's a debug APK
if [ -f "android/app/build/outputs/apk/debug/app-debug.apk" ]; then
    APK_SIZE=$(ls -lh android/app/build/outputs/apk/debug/app-debug.apk | awk '{print $5}')
    APK_DATE=$(ls -l android/app/build/outputs/apk/debug/app-debug.apk | awk '{print $6, $7, $8}')
    info "Debug APK exists ($APK_SIZE, built $APK_DATE)"
else
    info "Debug APK not found"
fi

echo ""
echo "8️⃣  CHECKING CAPACITOR CONFIGURATION"
echo "────────────────────────────────────────────────────────────"

if [ -f "capacitor.config.json" ]; then
    pass "capacitor.config.json exists"

    APP_ID=$(grep '"appId"' capacitor.config.json | sed 's/.*: "//;s/".*//')
    if [ "$APP_ID" = "com.delulu.college.app" ]; then
        pass "appId is com.delulu.college.app"
    else
        fail "appId is $APP_ID (should be com.delulu.college.app)"
    fi

    # Check for PushNotifications plugin config
    if grep -q "PushNotifications" capacitor.config.json; then
        pass "PushNotifications plugin configured"
    else
        warn "PushNotifications plugin NOT explicitly configured"
    fi
else
    fail "capacitor.config.json NOT FOUND"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  DIAGNOSTIC SUMMARY"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "📋 NEXT STEPS TO FIX NOTIFICATIONS:"
echo ""
echo "1. If google-services.json is missing com.delulu.college.app:"
echo "   → Copy new file: cp ~/Downloads/google-services\ \(1\).json android/app/google-services.json"
echo ""
echo "2. If any files are newer than the APK:"
echo "   → Rebuild APK:"
echo "     cd android"
echo "     ./gradlew clean"
echo "     ./gradlew assembleRelease"
echo ""
echo "3. Install the NEW APK on your device:"
echo "   → adb install -r android/app/build/outputs/apk/release/app-release.apk"
echo ""
echo "4. Test notifications:"
echo "   → Open app, ensure you're logged in"
echo "   → Check logcat: adb logcat | grep -E 'DeluluMessaging|FCM'"
echo "   → Send a test message from another account"
echo ""
echo "5. Check server logs for FCM sending:"
echo "   → Look for: 'FCM notification sent' or FCM errors"
echo ""
echo "════════════════════════════════════════════════════════════"
