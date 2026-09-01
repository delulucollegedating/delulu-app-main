#!/bin/bash
# Send a test notification to check if FCM is working

echo "════════════════════════════════════════════════════════════"
echo "  Delulu FCM Test Notification Sender"
echo "════════════════════════════════════════════════════════════"
echo ""

# Check if server is running
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "❌ Server is not running on localhost:3000"
    echo "   Start server with: npm run dev"
    echo ""
    exit 1
fi

echo "✅ Server is running"
echo ""

# Prompt for user ID
read -p "Enter your User ID (check Firestore users collection): " USER_ID

if [ -z "$USER_ID" ]; then
    echo "❌ User ID is required"
    exit 1
fi

echo ""
echo "📤 Sending test notification to user $USER_ID..."
echo ""

# Get auth token (you'll need to be logged in)
# For now, we'll use a simple approach - you need to get your session cookie

RESPONSE=$(curl -s -X POST http://localhost:3000/api/test-notification \
    -H "Content-Type: application/json" \
    -H "Cookie: connect.sid=YOUR_SESSION_COOKIE_HERE" \
    -d "{\"targetUserId\": $USER_ID}")

echo "Response:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
echo ""
echo "════════════════════════════════════════════════════════════"
echo ""
echo "📱 Check your device notification tray"
echo "🔍 Or run: adb logcat | grep -E 'DeluluMessaging|FCM'"
echo ""
