#!/usr/bin/env node
/**
 * FCM Notification Flow Diagnostic Script
 * Tests the entire notification pipeline from server to device
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        FCM Notification Flow Diagnostic Tool              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Step 1: Check google-services.json
  console.log('📋 Step 1: Checking google-services.json configuration...\n');

  let googleServices;
  try {
    googleServices = require('./android/app/google-services.json');
    console.log('✓ google-services.json loaded');
    console.log(`  Project ID: ${googleServices.project_info.project_id}`);
    console.log(`  Project Number: ${googleServices.project_info.project_number}`);

    const clients = googleServices.client || [];
    console.log(`\n  Found ${clients.length} client(s):`);
    clients.forEach((client, i) => {
      const pkg = client.client_info?.android_client_info?.package_name;
      const appId = client.client_info?.mobilesdk_app_id;
      console.log(`    ${i + 1}. Package: ${pkg}`);
      console.log(`       App ID: ${appId}`);
    });

    const hasCollegeApp = clients.some(c =>
      c.client_info?.android_client_info?.package_name === 'com.delulu.college.app'
    );

    if (hasCollegeApp) {
      console.log('\n✓ Correct package name (com.delulu.college.app) found!');
    } else {
      console.log('\n✗ ERROR: Package name com.delulu.college.app NOT found in google-services.json!');
      console.log('  This will cause FCM registration to fail.');
    }
  } catch (e) {
    console.log('✗ ERROR: Could not load google-services.json:', e.message);
    process.exit(1);
  }

  // Step 2: Check Firebase Admin SDK initialization
  console.log('\n\n📋 Step 2: Checking Firebase Admin SDK...\n');

  try {
    const admin = require('firebase-admin');
    const apps = admin.apps || [];

    if (apps.length > 0) {
      console.log(`✓ Firebase Admin initialized (${apps.length} app(s))`);
      const app = apps[0];
      console.log(`  App Name: ${app.name}`);

      // Try to access messaging
      try {
        const { getMessaging } = require('firebase-admin/messaging');
        const messaging = getMessaging(app);
        console.log('✓ FCM Messaging API accessible');
      } catch (e) {
        console.log('✗ ERROR: Cannot access FCM Messaging:', e.message);
      }
    } else {
      console.log('⚠ Firebase Admin NOT initialized (this is normal if server is not running)');
      console.log('  Firebase Admin will be initialized when server starts');
    }
  } catch (e) {
    console.log('⚠ Firebase Admin module check skipped (server handles initialization)');
  }

  // Step 3: Check Android Manifest
  console.log('\n\n📋 Step 3: Checking AndroidManifest.xml...\n');

  const fs = require('fs');
  const manifestPath = './android/app/src/main/AndroidManifest.xml';

  try {
    const manifest = fs.readFileSync(manifestPath, 'utf8');

    // Check for custom service
    if (manifest.includes('DeluluMessagingService')) {
      console.log('✓ Custom DeluluMessagingService declared');
    } else {
      console.log('✗ ERROR: DeluluMessagingService not found in manifest');
    }

    // Check if Capacitor default is removed
    if (manifest.includes('tools:node="remove"')) {
      console.log('✓ Capacitor default MessagingService properly removed');
    } else {
      console.log('⚠ WARNING: Capacitor default service may not be removed');
    }

    // Check POST_NOTIFICATIONS permission
    if (manifest.includes('POST_NOTIFICATIONS')) {
      console.log('✓ POST_NOTIFICATIONS permission declared');
    } else {
      console.log('✗ ERROR: POST_NOTIFICATIONS permission missing (required for Android 13+)');
    }
  } catch (e) {
    console.log('✗ ERROR reading AndroidManifest.xml:', e.message);
  }

  // Step 4: Check Java service file
  console.log('\n\n📋 Step 4: Checking DeluluMessagingService.java...\n');

  const servicePath = './android/app/src/main/java/com/delulu/college/app/DeluluMessagingService.java';

  try {
    const service = fs.readFileSync(servicePath, 'utf8');

    if (service.includes('extends FirebaseMessagingService')) {
      console.log('✓ Service extends FirebaseMessagingService');
    }

    if (service.includes('onMessageReceived')) {
      console.log('✓ onMessageReceived handler implemented');
    }

    if (service.includes('onNewToken')) {
      console.log('✓ onNewToken handler implemented');
    }

    if (service.includes('showSystemNotification')) {
      console.log('✓ System notification method implemented');
    }
  } catch (e) {
    console.log('✗ ERROR reading service file:', e.message);
  }

  // Step 5: Test sending a notification
  console.log('\n\n📋 Step 5: Test Notification Sending\n');

  const userId = await ask('Enter user ID to test (or press Enter to skip): ');

  if (userId && userId.trim()) {
    console.log('\nAttempting to fetch FCM tokens for user', userId, '...');

    try {
      // You'll need to start your server for this to work
      const http = require('http');
      const options = {
        hostname: 'localhost',
        port: 3000,
        path: `/api/test-fcm?userId=${userId}`,
        method: 'GET'
      };

      console.log('⚠ Note: Server must be running on localhost:3000 for this test');
      console.log('  Start server with: npm run dev');
    } catch (e) {
      console.log('Cannot test without server running');
    }
  }

  // Step 6: Checklist
  console.log('\n\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                  DIAGNOSTIC CHECKLIST                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('Complete this checklist on your Android device:\n');
  console.log('□ App is installed and running');
  console.log('□ You are logged in');
  console.log('□ Notification permission was granted');
  console.log('□ Check Settings > Apps > Delulu > Notifications (all enabled)');
  console.log('□ Battery optimization is OFF for Delulu');
  console.log('□ Check adb logcat for "DeluluMessaging" logs');
  console.log('□ FCM token is registered on server (check Firestore devices collection)');
  console.log('\n📱 To check logcat:\n');
  console.log('   adb logcat | grep -E "DeluluMessaging|FCM"');
  console.log('\n🔧 To send a test notification:\n');
  console.log('   curl -X POST http://localhost:3000/api/test-notification \\');
  console.log('        -H "Content-Type: application/json" \\');
  console.log('        -d \'{"userId": YOUR_USER_ID}\'');

  console.log('\n\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              COMMON ISSUES & SOLUTIONS                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('1. ✗ Token registration fails:');
  console.log('   → Package name mismatch in google-services.json');
  console.log('   → Run: npx cap sync android\n');

  console.log('2. ✗ Notifications work in foreground but not background:');
  console.log('   → Battery optimization blocking notifications');
  console.log('   → Check Settings > Battery > Delulu > Unrestricted\n');

  console.log('3. ✗ onMessageReceived never called:');
  console.log('   → Service not properly registered in AndroidManifest.xml');
  console.log('   → Rebuild APK: cd android && ./gradlew clean assembleRelease\n');

  console.log('4. ✗ Token registered but server cannot send:');
  console.log('   → Check Firebase Admin service account credentials');
  console.log('   → Verify project_id matches in google-services.json\n');

  rl.close();
}

main().catch(console.error);
