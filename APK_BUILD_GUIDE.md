# APK & Mobile Build Guide — Delulu Android & iOS

> **Purpose**: Complete manual for building, signing, distributing, debugging, and maintaining the **Delulu Mobile Applications** (Android APK and iOS IPA) built with **Capacitor 8**.

---

## 1. Mobile Architecture Overview

Delulu uses **Capacitor 8** to package its mobile-first web frontend (`delulu-college/public`) as high-performance native apps for Android and iOS.

```
┌─────────────────────────────────────────────────────────────┐
│                   Delulu Mobile App Architecture            │
├─────────────────────────────────────────────────────────────┤
│  Frontend (HTML5 + Tailwind CSS + Vanilla JS + Three.js)   │
│  Offline Cache (Dexie.js IndexedDB) + Web Crypto E2EE       │
├─────────────────────────────────────────────────────────────┤
│                    Capacitor 8 Bridge                       │
│  - @capacitor/app              - @capacitor/preferences     │
│  - @capacitor/push-notifications - @capacitor/local-notifs │
├─────────────────────────────────────────────────────────────┤
│               Native Android Container                      │
│  - MainActivity.java (FLAG_SECURE + HW Acceleration)        │
│  - Firebase Cloud Messaging (FCM) Push Service              │
│  - delulu_messages Notification Channel (High Importance)   │
│  - Proguard / R8 Minification & Resource Shrinking          │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Key Files & Locations

| File / Folder | Purpose |
|---|---|
| `delulu.apk` (Root) | Primary distribution copy of the production Android APK (~18MB) |
| `delulu-college/builds/delulu.apk` | Build output destination served by backend via `/delulu.apk` |
| `delulu-college/builds/delulu.ipa` | iOS build archive package |
| `delulu-college/capacitor.config.json` | Capacitor app configuration (ID, name, server, plugins) |
| `delulu-college/android/` | Android Studio project root |
| `delulu-college/android/app/build.gradle` | Gradle build config, release signing, Proguard rules |
| `delulu-college/android/app/src/main/AndroidManifest.xml` | App permissions, hardware acceleration, FCM setup |
| `delulu-college/android/app/src/main/java/.../MainActivity.java` | Native lifecycle, `FLAG_SECURE` screen privacy |
| `delulu-college/scripts/generate-release-keystore.sh` | Shell script to generate release signing keystore |
| `delulu-college/android/keystore/delulu-release.keystore` | Android release signing keystore |

---

## 3. Capacitor Configuration (`capacitor.config.json`)

```json
{
  "appId": "com.delulu.college.app",
  "appName": "Delulu",
  "webDir": "public",
  "server": {
    "androidScheme": "https",
    "allowNavigation": [
      "delulu-app-main-production.up.railway.app",
      "*.railway.app",
      "*.onrender.com"
    ]
  },
  "android": {
    "allowMixedContent": false,
    "captureInput": true,
    "webContentsDebuggingEnabled": false
  },
  "ios": {
    "contentInset": "always",
    "allowsLinkPreview": false,
    "scrollEnabled": true
  },
  "plugins": {
    "Config": {
      "apiBaseUrl": "https://delulu-app-main-production.up.railway.app"
    },
    "PushNotifications": {
      "presentationOptions": ["badge", "sound", "alert"]
    }
  }
}
```

---

## 4. Native Security & Android Settings

### 4.1 Screenshot & Screen Recording Prevention (`FLAG_SECURE`)
In `MainActivity.java`:
```java
// Prevents screenshots and screen recording across the app for student privacy
getWindow().setFlags(
    WindowManager.LayoutParams.FLAG_SECURE,
    WindowManager.LayoutParams.FLAG_SECURE
);
```
- When running on Android, any screenshot attempt shows a black screen or "Can't take screenshot due to security policy".
- Protects student identities, chat transcripts, and photos.

### 4.2 Hardware Accelerated WebView
```java
WebView webView = getBridge().getWebView();
if (webView != null) {
    WebSettings settings = webView.getSettings();
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setCacheMode(WebSettings.LOAD_DEFAULT);
    webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
    webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
}
```

### 4.3 High-Importance Notification Channel
- **Channel ID**: `delulu_messages`
- **Channel Name**: `Delulu Chat Messages`
- **Importance**: `NotificationManager.IMPORTANCE_HIGH`
- **Capabilities**: Custom vibration, lights, app badge, public lockscreen visibility.

### 4.4 Permissions Breakdown
```xml
<!-- Network Connectivity -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- Background Push Notifications -->
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<!-- Camera & Photos (Avatar & Verification) -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />

<!-- Voice Notes -->
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

---

## 5. Building the Android APK (Step-by-Step)

### Prerequisites:
- Node.js 22+
- Java Development Kit (JDK 17 or JDK 21)
- Android SDK (installed via Android Studio or command-line tools)

---

### Step 1: Prepare Web Assets & Tailwind CSS
```bash
cd delulu-college

# 1. Build and minify production CSS
npm run build:css

# 2. Update profanity word list for client check
npm run generate:profanity
```

---

### Step 2: Synchronize with Capacitor Android
```bash
# Copies public/ to android/app/src/main/assets/public/ and updates plugins
npx cap sync android
```

---

### Step 3: Configure Signing Keystore (For Release Builds)

If you haven't generated a release keystore yet:
```bash
bash scripts/generate-release-keystore.sh YourSecurePassword
```
This generates `android/keystore/delulu-release.keystore` with:
- Alias: `delulu`
- Store Type: PKCS12 / JKS
- Algorithm: RSA 2048-bit

Export or set the environment variables:
```bash
export RELEASE_STORE_PASSWORD="YourSecurePassword"
export RELEASE_KEY_ALIAS="delulu"
export RELEASE_KEY_PASSWORD="YourSecurePassword"
```
*(Note: If environment variables are omitted, `build.gradle` automatically falls back to debug signing for local development).*

---

### Step 4: Compile APK via Gradle

#### Option A: Release APK (Optimized, Minified & Signed)
```bash
cd android
./gradlew assembleRelease
```
Output location:
`android/app/build/outputs/apk/release/app-release.apk`

#### Option B: Debug APK (For fast local device testing)
```bash
cd android
./gradlew assembleDebug
```
Output location:
`android/app/build/outputs/apk/debug/app-debug.apk`

---

### Step 5: Copy APK to Distribution Paths
```bash
# From delulu-college/ directory:
cp android/app/build/outputs/apk/release/app-release.apk builds/delulu.apk
cp android/app/build/outputs/apk/release/app-release.apk ../delulu.apk
```

---

## 6. Testing & Running on Device

### Run via Command Line (ADB):
```bash
# Ensure device is connected via USB with Developer Options & USB Debugging ON
adb devices

# Install APK directly
adb install -r builds/delulu.apk

# Launch App
adb shell monkey -p com.delulu.college.app -c android.intent.category.LAUNCHER 1
```

### Run via Android Studio:
```bash
cd delulu-college
npx cap open android
```
- Click **Run 'app'** (Green play button) in Android Studio to launch on connected device or emulator.

---

## 7. APK Distribution & Server Endpoints

The backend server serves the release APK directly to mobile web users:

### Endpoints in `server.js`:
- `GET /delulu.apk`
- `GET /api/download-apk`

### Rate Limiting & Safety:
- Protected by `apkLimiter`: max 30 downloads per 15 minutes per IP.
- Served with proper MIME type `application/vnd.android.package-archive`.

```javascript
app.get(['/delulu.apk', '/api/download-apk'], apkLimiter, (req, res) => {
  const apkPath = path.join(__dirname, 'builds', 'delulu.apk');
  if (fs.existsSync(apkPath)) {
    res.download(apkPath, 'delulu.apk');
  } else {
    res.status(404).json({ error: 'APK build currently unavailable' });
  }
});
```

---

## 8. Mobile Auth & Push Notifications

### 8.1 HMAC Bearer Auth Token Storage
In Android WebView, cookies can be volatile across deep sleeps or app updates. 
Delulu implements a robust native storage mechanism:
- On login/signup: HMAC-signed token is stored in **`@capacitor/preferences`** (native Android SharedPreferences).
- On every network request: Injected as `Authorization: Bearer <token>`.
- On logout / password reset: `token_version` is bumped in Firestore, immediately invalidating old tokens on all devices.

### 8.2 Push Notifications via FCM (Firebase Cloud Messaging)
1. Device registers via `@capacitor/push-notifications`.
2. FCM Token sent to backend: `POST /api/devices/register` with `{ platform: "android_fcm", fcm_token: "..." }`.
3. Stored in Firestore: `users/{userId}/devices/{deviceId}`.
4. Backend `services/notificationDispatcher.js` dispatches notifications using Firebase Admin SDK:
   - Skips push if receiver is actively in the SSE chat room.
   - Automatically prunes invalid/expired tokens (410 Gone / `messaging/registration-token-not-registered`).

---

## 9. Troubleshooting & Common Issues

| Issue | Cause | Fix |
|---|---|---|
| White screen on app start | Web assets not synced or CSS missing | Run `npm run build:css` and `npx cap sync android` |
| Screenshots showing black | `FLAG_SECURE` is active | Expected security feature in `MainActivity.java` |
| Notifications not received | Missing `google-services.json` | Ensure `android/app/google-services.json` is present |
| Release build fails on signing | Keystore missing or wrong password | Check `RELEASE_STORE_PASSWORD` and `RELEASE_KEY_ALIAS` |
| Cleartext HTTP blocked | Android 9+ default network policy | `capacitor.config.json` uses `androidScheme: "https"` and HTTPS endpoints |
| Changes in JS not showing | Assets cached in Gradle build | Run `./gradlew clean` inside `android/` and re-sync |
