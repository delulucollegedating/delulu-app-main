#!/bin/bash
# One-command fix for most common FCM notification issues

echo "════════════════════════════════════════════════════════════"
echo "  🔧 Delulu Notification Fix Script"
echo "════════════════════════════════════════════════════════════"
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if adb is available
if ! command -v adb &> /dev/null; then
    echo -e "${RED}✗ adb not found${NC}"
    echo "  Install Android SDK Platform Tools first"
    exit 1
fi

# Check device
DEVICE_COUNT=$(adb devices | grep -c "device$")
if [ "$DEVICE_COUNT" -eq 0 ]; then
    echo -e "${RED}✗ No device connected${NC}"
    echo "  Connect your Android device with USB debugging enabled"
    exit 1
fi

echo -e "${GREEN}✓ Device connected${NC}"
echo ""

PACKAGE="com.delulu.college.app"

# Ask what to do
echo "Choose a fix option:"
echo ""
echo "  1) Full clean reinstall (recommended if nothing works)"
echo "  2) Just grant notification permission"
echo "  3) Check current status only"
echo "  4) Rebuild APK only"
echo ""
read -p "Enter choice (1-4): " CHOICE

case $CHOICE in
  1)
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "  Full Clean Reinstall Process"
    echo "════════════════════════════════════════════════════════════"
    echo ""

    # Step 1: Clean build
    echo -e "${BLUE}[1/6]${NC} Cleaning Android build..."
    cd android
    ./gradlew clean > /dev/null 2>&1
    echo -e "${GREEN}✓${NC} Build cleaned"

    # Step 2: Sync Capacitor
    echo -e "${BLUE}[2/6]${NC} Syncing Capacitor..."
    cd ..
    npx cap sync android > /dev/null 2>&1
    echo -e "${GREEN}✓${NC} Capacitor synced"

    # Step 3: Rebuild APK
    echo -e "${BLUE}[3/6]${NC} Rebuilding release APK (this takes ~30 seconds)..."
    cd android
    ./gradlew assembleRelease > /dev/null 2>&1

    if [ -f "app/build/outputs/apk/release/app-release.apk" ]; then
        echo -e "${GREEN}✓${NC} APK built successfully"
    else
        echo -e "${RED}✗${NC} APK build failed"
        echo "  Run manually: cd android && ./gradlew assembleRelease"
        exit 1
    fi

    # Step 4: Uninstall old app
    echo -e "${BLUE}[4/6]${NC} Uninstalling old app..."
    adb uninstall $PACKAGE > /dev/null 2>&1
    echo -e "${GREEN}✓${NC} Old app removed"

    # Step 5: Install new APK
    echo -e "${BLUE}[5/6]${NC} Installing fresh APK..."
    adb install app/build/outputs/apk/release/app-release.apk > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} APK installed"
    else
        echo -e "${RED}✗${NC} Installation failed"
        echo "  Try manually: adb install android/app/build/outputs/apk/release/app-release.apk"
        exit 1
    fi

    # Step 6: Grant notification permission
    echo -e "${BLUE}[6/6]${NC} Granting notification permission..."
    adb shell pm grant $PACKAGE android.permission.POST_NOTIFICATIONS > /dev/null 2>&1
    echo -e "${GREEN}✓${NC} Permission granted"

    cd ..

    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo -e "${GREEN}✓ COMPLETE!${NC}"
    echo "════════════════════════════════════════════════════════════"
    echo ""
    echo "Next steps:"
    echo "  1. Open the app on your device"
    echo "  2. Log in with your account"
    echo "  3. Send a test message from another account"
    echo "  4. Run: ./test-fcm-flow.sh to monitor live"
    echo ""
    ;;

  2)
    echo ""
    echo "Granting notification permission..."
    adb shell pm grant $PACKAGE android.permission.POST_NOTIFICATIONS

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Permission granted${NC}"
        echo ""
        echo "Now try sending a notification"
    else
        echo -e "${YELLOW}⚠ Could not grant permission via adb${NC}"
        echo "Grant manually: Settings → Apps → Delulu → Notifications → Allow"
    fi
    ;;

  3)
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "  Current Status"
    echo "════════════════════════════════════════════════════════════"
    echo ""

    # Check if installed
    if adb shell pm list packages | grep -q "$PACKAGE"; then
        echo -e "${GREEN}✓${NC} App installed"

        VERSION=$(adb shell dumpsys package $PACKAGE | grep versionName | head -1 | sed 's/.*versionName=//')
        echo "  Version: $VERSION"

        # Check permission
        ANDROID_VERSION=$(adb shell getprop ro.build.version.release)
        if [ "$(echo "$ANDROID_VERSION" | cut -d. -f1)" -ge 13 ]; then
            PERM_COUNT=$(adb shell dumpsys package $PACKAGE | grep "android.permission.POST_NOTIFICATIONS" | grep -c "granted=true")
            if [ "$PERM_COUNT" -gt 0 ]; then
                echo -e "${GREEN}✓${NC} Notification permission granted"
            else
                echo -e "${RED}✗${NC} Notification permission NOT granted"
                echo "  Fix: Run option 2 or grant in Settings"
            fi
        else
            echo -e "${BLUE}ℹ${NC} Android < 13 - no runtime permission needed"
        fi

        # Check battery optimization
        if adb shell dumpsys deviceidle whitelist | grep -q "$PACKAGE"; then
            echo -e "${GREEN}✓${NC} Battery optimization disabled"
        else
            echo -e "${YELLOW}⚠${NC} Battery optimization enabled (may delay notifications)"
            echo "  Settings → Apps → Delulu → Battery → Unrestricted"
        fi
    else
        echo -e "${RED}✗${NC} App NOT installed"
        echo "  Run option 1 to install"
    fi

    echo ""
    echo "To monitor notifications in real-time:"
    echo "  ./test-fcm-flow.sh"
    ;;

  4)
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "  Rebuilding APK"
    echo "════════════════════════════════════════════════════════════"
    echo ""

    echo -e "${BLUE}[1/3]${NC} Cleaning build..."
    cd android
    ./gradlew clean > /dev/null 2>&1
    echo -e "${GREEN}✓${NC} Cleaned"

    echo -e "${BLUE}[2/3]${NC} Syncing Capacitor..."
    cd ..
    npx cap sync android > /dev/null 2>&1
    echo -e "${GREEN}✓${NC} Synced"

    echo -e "${BLUE}[3/3]${NC} Building release APK..."
    cd android
    ./gradlew assembleRelease

    if [ -f "app/build/outputs/apk/release/app-release.apk" ]; then
        echo ""
        echo -e "${GREEN}✓ APK built successfully${NC}"
        echo ""
        echo "To install:"
        echo "  adb install -r android/app/build/outputs/apk/release/app-release.apk"
    else
        echo -e "${RED}✗ Build failed${NC}"
    fi

    cd ..
    ;;

  *)
    echo "Invalid choice"
    exit 1
    ;;
esac
