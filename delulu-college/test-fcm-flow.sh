#!/bin/bash
# Real-time FCM notification flow tester

echo "════════════════════════════════════════════════════════════"
echo "  FCM Notification Flow Tester"
echo "════════════════════════════════════════════════════════════"
echo ""

# Check if adb is available
if ! command -v adb &> /dev/null; then
    echo "❌ adb not found. Install Android SDK Platform Tools"
    exit 1
fi

# Check if device is connected
DEVICE_COUNT=$(adb devices | grep -c "device$")
if [ "$DEVICE_COUNT" -eq 0 ]; then
    echo "❌ No Android device connected"
    echo "   Connect your device and enable USB debugging"
    exit 1
fi

echo "✅ Device connected"
DEVICE_MODEL=$(adb shell getprop ro.product.model)
ANDROID_VERSION=$(adb shell getprop ro.build.version.release)
echo "   Device: $DEVICE_MODEL (Android $ANDROID_VERSION)"
echo ""

# Check if app is installed
PACKAGE="com.delulu.college.app"
if adb shell pm list packages | grep -q "$PACKAGE"; then
    echo "✅ App installed ($PACKAGE)"

    # Get app version
    VERSION=$(adb shell dumpsys package $PACKAGE | grep versionName | head -1 | sed 's/.*versionName=//')
    echo "   Version: $VERSION"
else
    echo "❌ App NOT installed"
    echo "   Install with: adb install -r android/app/build/outputs/apk/release/app-release.apk"
    exit 1
fi

echo ""
echo "📱 Checking notification permissions..."

# Check if POST_NOTIFICATIONS permission is granted (Android 13+)
if [ "$(echo "$ANDROID_VERSION" | cut -d. -f1)" -ge 13 ]; then
    NOTIF_PERM=$(adb shell dumpsys package $PACKAGE | grep "android.permission.POST_NOTIFICATIONS" | grep "granted=true" | wc -l)
    if [ "$NOTIF_PERM" -gt 0 ]; then
        echo "✅ POST_NOTIFICATIONS permission granted"
    else
        echo "❌ POST_NOTIFICATIONS permission NOT granted"
        echo "   The app cannot show notifications!"
        echo "   Open app and grant notification permission when prompted"
    fi
else
    echo "ℹ️  Android < 13 - no runtime notification permission needed"
fi

# Check battery optimization
echo ""
echo "📱 Checking battery optimization..."
BATTERY_OPT=$(adb shell dumpsys deviceidle whitelist | grep -c "$PACKAGE")
if [ "$BATTERY_OPT" -gt 0 ]; then
    echo "✅ App whitelisted from battery optimization"
else
    echo "⚠️  App NOT whitelisted - notifications may be delayed in background"
    echo "   Settings → Apps → Delulu → Battery → Unrestricted"
fi

echo ""
echo "────────────────────────────────────────────────────────────"
echo "🔍 MONITORING FCM LOGS (Press Ctrl+C to stop)"
echo "────────────────────────────────────────────────────────────"
echo ""
echo "Waiting for FCM messages and notification events..."
echo "Send a test message or trigger a notification in the app now"
echo ""

# Clear logcat and start monitoring
adb logcat -c
adb logcat -v time | grep -E --line-buffered "DeluluMessaging|FCM|firebase\.messaging|PushNotifications|NotificationManager|onMessageReceived|FCM TOKEN|registration token" | while read -r line; do
    # Highlight important events
    if echo "$line" | grep -q "FCM MESSAGE RECEIVED"; then
        echo -e "\033[1;32m📩 $line\033[0m"
    elif echo "$line" | grep -q "SYSTEM NOTIFICATION COMPLETED"; then
        echo -e "\033[1;32m✅ $line\033[0m"
    elif echo "$line" | grep -q "FCM TOKEN"; then
        echo -e "\033[1;34m🔑 $line\033[0m"
    elif echo "$line" | grep -q "ERROR\|FAILED\|error"; then
        echo -e "\033[1;31m❌ $line\033[0m"
    else
        echo "$line"
    fi
done
