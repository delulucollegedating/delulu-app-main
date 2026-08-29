#!/bin/bash
# Push Notification Test Script
# Use this to verify push notifications are working

echo "🔔 Delulu Push Notification Test Script"
echo "========================================"
echo ""

# Check if device is connected
if ! adb devices | grep -q "device$"; then
    echo "❌ No Android device connected via ADB"
    echo "   Connect a device and enable USB debugging"
    exit 1
fi

echo "✓ Device connected"
echo ""

# Check if app is installed
PACKAGE="com.delulu.college.app"
if ! adb shell pm list packages | grep -q "$PACKAGE"; then
    echo "❌ Delulu app not installed"
    echo "   Install the APK first: adb install -r android/app/build/outputs/apk/release/app-release.apk"
    exit 1
fi

echo "✓ App installed"
echo ""

echo "📱 Checking notification settings..."
echo ""

# Check if notification permission is granted
NOTIF_PERM=$(adb shell dumpsys package $PACKAGE | grep "android.permission.POST_NOTIFICATIONS" -A 1 | grep granted || echo "denied")
if echo "$NOTIF_PERM" | grep -q "granted"; then
    echo "✓ POST_NOTIFICATIONS permission: GRANTED"
else
    echo "⚠️  POST_NOTIFICATIONS permission: DENIED or NOT SET"
    echo "   User needs to enable notifications in app or Android Settings"
fi

# Check battery optimization status
BATTERY=$(adb shell dumpsys deviceidle whitelist | grep "$PACKAGE" || echo "not whitelisted")
if echo "$BATTERY" | grep -q "$PACKAGE"; then
    echo "✓ Battery optimization: EXEMPTED (instant delivery)"
else
    echo "⚠️  Battery optimization: NOT EXEMPTED (notifications may be delayed)"
    echo "   App should request exemption on first launch"
fi

echo ""
echo "📊 Monitoring push notifications..."
echo "   (Send a test message and watch for FCM events)"
echo "   Press Ctrl+C to stop"
echo ""

# Monitor logcat for FCM and notification events
adb logcat -c  # Clear log
adb logcat -s DeluluMessaging:D FCMService:D PushNotifications:D NotificationManager:I FirebaseMessaging:D | while read line; do
    if echo "$line" | grep -q "FCM message received"; then
        echo "📨 FCM message arrived!"
    elif echo "$line" | grep -q "System notification shown"; then
        echo "✅ System notification displayed!"
    elif echo "$line" | grep -q "onMessageReceived"; then
        echo "📬 FCM service received message"
    elif echo "$line" | grep -q "Notification received"; then
        echo "🔔 Capacitor plugin processed notification"
    fi
    echo "   $line"
done
