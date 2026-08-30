const { getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const CircuitBreaker = require('../utils/circuitBreaker');
const webPush = require('web-push');
const { pushOps, isFirebaseConfigured } = require('../database');

// Configure Web Push VAPID details so this module can send directly to
// device subscriptions stored in the users/{userId}/devices subcollection.
// server.js calls configureWebPush() at startup with its resolved keys so
// the dispatcher always uses the exact same keys clients subscribed with
// (server.js may auto-generate temporary keys when env vars are unset).
let vapidConfigured = false;
function configureWebPush(publicKey, privateKey) {
  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return;
  }
  try {
    webPush.setVapidDetails(
      `mailto:${process.env.GMAIL_USER || 'deluluxcollegedating@gmail.com'}`,
      publicKey,
      privateKey
    );
    vapidConfigured = true;
  } catch (e) {
    vapidConfigured = false;
  }
}

function getSafeNotificationBody(payload = {}) {
  const encrypted = payload.isEncrypted === true || Number(payload.is_encrypted) === 1;
  if (encrypted) return 'Encrypted message';
  return String(payload.body || 'Someone sent you a message');
}

// Auto-configure from env at load so this module still works standalone
// (e.g. in tests) even if server.js never calls configureWebPush().
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  configureWebPush(process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

/**
 * Build the JSON payload sent to web-push. Includes type + connectionId so the
 * service worker (sw.js) can show a meaningful title and route taps correctly.
 */
function buildWebPushPayload(payload, connectionId) {
  const notifTitle = String(payload.title || 'New Notification');
  const notifBody = getSafeNotificationBody(payload);
  const targetUrl = payload.url || (connectionId ? `/chat.html?id=${connectionId}` : '/messages.html');
  return JSON.stringify({
    title: notifTitle,
    body: notifBody,
    url: targetUrl,
    type: String(payload.type || 'chat_message'),
    connectionId: String(connectionId || ''),
    senderId: String(payload.senderId || ''),
    senderName: String(payload.senderName || payload.title || 'User'),
    isEncrypted: payload.isEncrypted === true || Number(payload.is_encrypted) === 1,
    icon: '/favicon.ico'
  });
}

/**
 * Send a web push notification to a single subscription.
 * Throws with ._gone = true when the subscription is dead (410/404) so callers
 * can clean up the registered device.
 */
async function sendWebPush(subscription, payload, connectionId) {
  if (!subscription || !subscription.endpoint) return;
  if (!vapidConfigured) return;
  try {
    await webPush.sendNotification(subscription, buildWebPushPayload(payload, connectionId));
  } catch (err) {
    if (err && (err.statusCode === 410 || err.statusCode === 404)) {
      err._gone = true;
    }
    throw err;
  }
}

// Circuit breaker specifically for FCM push service calls
const fcmBreaker = new CircuitBreaker('fcmPushService', {
  timeoutMs: 5000,
  failureThreshold: 3,
  resetTimeoutMs: 10000,
  maxConcurrent: 20
});

// Circuit breaker for Web Push service calls
const pushBreaker = new CircuitBreaker('webPushService', {
  timeoutMs: 5000,
  failureThreshold: 3,
  resetTimeoutMs: 10000,
  maxConcurrent: 20
});

function getDB() {
  const apps = getApps();
  if (apps.length === 0) {
    throw new Error('Firebase app is not initialized.');
  }
  return getFirestore(apps[0]);
}

function getMessagingInstance() {
  if (typeof isFirebaseConfigured === 'function' && !isFirebaseConfigured()) return null;
  const apps = getApps();
  if (apps.length === 0) return null;
  return getMessaging(apps[0]);
}

/**
 * Register or update a device token for a user under users/{userId}/devices/{deviceId}
 */
const MAX_DEVICES_PER_USER = 10;

async function registerDevice(userId, deviceData) {
  if (!userId || !deviceData || !deviceData.deviceId) {
    return { error: 'Missing userId or deviceId' };
  }

  const firestore = getDB();
  const deviceRef = firestore
    .collection('users')
    .doc(String(userId))
    .collection('devices')
    .doc(String(deviceData.deviceId));

  // Bound the number of registered devices per account so a malicious client
  // cannot bloat the devices subcollection. When the cap is reached, evict the
  // least-recently-active device to make room (registration always succeeds).
  try {
    const existingSnap = await deviceRef.get();
    if (!existingSnap.exists) {
      const allSnap = await firestore
        .collection('users')
        .doc(String(userId))
        .collection('devices')
        .limit(MAX_DEVICES_PER_USER + 1)
        .get();
      if (allSnap.size > MAX_DEVICES_PER_USER) {
        const candidates = allSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.last_active_at || '').localeCompare(String(b.last_active_at || '')));
        const toEvict = candidates[0];
        if (toEvict) {
          await firestore
            .collection('users')
            .doc(String(userId))
            .collection('devices')
            .doc(String(toEvict.id))
            .delete();
        }
      }
    }
  } catch (err) {
    // Never block registration on the eviction bookkeeping.
    console.warn('Device cap check failed:', err.message);
  }

  const platform = deviceData.platform === 'android_fcm' || deviceData.platform === 'android'
    ? 'android_fcm'
    : 'web_push';

  const payload = {
    platform,
    fcm_token: deviceData.token || deviceData.fcm_token || null,
    web_push_subscription: deviceData.web_push_subscription || null,
    app_version: deviceData.app_version || '1.0.0',
    device_model: deviceData.device_model || 'Unknown Device',
    created_at: deviceData.created_at || new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    active: true
  };

  await deviceRef.set(payload, { merge: true });
  return { success: true, deviceId: deviceData.deviceId, platform };
}

/**
 * Deactivate or remove a device doc on logout or token revocation
 */
async function unregisterDevice(userId, deviceId) {
  if (!userId || !deviceId) return { error: 'Missing userId or deviceId' };

  try {
    const firestore = getDB();
    const deviceRef = firestore
      .collection('users')
      .doc(String(userId))
      .collection('devices')
      .doc(String(deviceId));

    await deviceRef.delete();
    return { success: true };
  } catch (err) {
    console.error(`Error unregistering device ${deviceId} for user ${userId}:`, err.message);
    return { error: err.message };
  }
}

/**
 * Fetch all active devices for a given user
 */
async function getActiveDevices(userId) {
  if (!userId || (typeof isFirebaseConfigured === 'function' && !isFirebaseConfigured())) return [];
  try {
    const firestore = getDB();
    const snap = await firestore
      .collection('users')
      .doc(String(userId))
      .collection('devices')
      .where('active', '==', true)
      .get();

    const devices = [];
    snap.forEach(doc => {
      devices.push({ deviceId: doc.id, ...doc.data() });
    });
    return devices;
  } catch (err) {
    console.warn(`Error fetching devices for user ${userId}:`, err.message);
    return [];
  }
}

/**
 * Dispatch notifications across platform channels (FCM for Android app, Web Push for browser)
 */
async function dispatchNotification(receiverId, connectionId, payload = {}, ssePresenceChecker = null) {
  if (!receiverId) return { dispatched: false, reason: 'missing_receiver' };

  // Instagram/WhatsApp-style suppression: if the recipient is currently
  // connected to THIS exact conversation (via the SSE room presence tracked
  // in server.js's activeRoomUsers), they're already looking at the message
  // in realtime, so an FCM push would be a redundant system notification.
  // ssePresenceChecker(receiverId, connectionId) returns true only when the
  // recipient is present in this specific conversation's room — being online
  // elsewhere in the app (messages list, another chat, etc.) does NOT suppress.
  // The checker may be async (cross-instance roster lookup) — awaited here.
  const suppressFcm = typeof ssePresenceChecker === 'function'
    && payload.type === 'chat_message'
    && connectionId
    && !!(await Promise.resolve(ssePresenceChecker(receiverId, connectionId)));

  // 1. Fetch registered devices for the receiver
  const devices = await getActiveDevices(receiverId);
  const fcmDevices = devices.filter(d => d.platform === 'android_fcm' && d.fcm_token);
  const legacyTokens = await pushOps.getFCMTokens(receiverId).catch(() => []);
  const fcmTokenSources = new Map();

  const addFcmToken = (token, deviceId = null, legacy = false) => {
    if (typeof token !== 'string') return;
    const normalizedToken = token.trim();
    if (!normalizedToken || normalizedToken.length > 512) return;
    const source = fcmTokenSources.get(normalizedToken) || { deviceIds: [], legacy: false };
    if (deviceId && !source.deviceIds.includes(deviceId)) source.deviceIds.push(deviceId);
    source.legacy = source.legacy || legacy;
    fcmTokenSources.set(normalizedToken, source);
  };

  fcmDevices.forEach(device => addFcmToken(device.fcm_token, device.deviceId));
  (Array.isArray(legacyTokens) ? legacyTokens : []).forEach(token => addFcmToken(token, null, true));

  const webDevices = devices.filter(d => d.platform === 'web_push');

  // Legacy push_subs subscriptions (registered before the devices subcollection
  // existed) must still receive pushes even when the user ALSO has device docs.
  // Previously this fallback only ran when devices.length === 0, so a user with
  // one Android phone and an old browser subscription silently lost browser
  // notifications. Dedupe by endpoint so nobody receives duplicates.
  const activeWebEndpoints = new Set(
    webDevices.map(d => d.web_push_subscription && d.web_push_subscription.endpoint).filter(Boolean)
  );
  let legacyWebSubs = [];
  try {
    const allLegacySubs = await pushOps.getSubscriptions(receiverId).catch(() => []);
    legacyWebSubs = (Array.isArray(allLegacySubs) ? allLegacySubs : []).filter(sub =>
      sub && sub.endpoint && !activeWebEndpoints.has(sub.endpoint)
    );
  } catch (legacyErr) {}

  const dispatchResults = { fcm: 0, web: 0, errors: [] };

  // 2. Dispatch to Android FCM devices (instant high-priority delivery)
  if (suppressFcm) {
    dispatchResults.suppressed = 'recipient_in_conversation';
  } else if (fcmTokenSources.size > 0) {
    const messaging = getMessagingInstance();
    if (messaging) {
      const tokens = Array.from(fcmTokenSources.keys());
      const notifTitle = String(payload.title || 'New Message');
      const notifBody = getSafeNotificationBody(payload);
      const targetUrl = payload.url || (connectionId ? `/chat.html?id=${connectionId}` : '/messages.html');

      const multicastMessage = {
        tokens,
        notification: {
          title: notifTitle,
          body: notifBody
        },
        data: {
          type: String(payload.type || 'chat_message'),
          connectionId: String(connectionId || ''),
          senderId: String(payload.senderId || ''),
          senderName: String(payload.senderName || payload.title || 'User'),
          messageId: String(payload.messageId || ''),
          createdAt: String(payload.createdAt || new Date().toISOString()),
          isEncrypted: String(payload.isEncrypted === true || Number(payload.is_encrypted) === 1),
          title: notifTitle,
          body: notifBody,
          url: targetUrl
        },
        android: {
          priority: 'high',
          // Critical: Set TTL to 0 for instant delivery, bypassing FCM throttling
          ttl: 0,
          // Restrict delivery only to high-priority connections (bypass doze)
          restrictedPackageName: null,
          notification: {
            title: notifTitle,
            body: notifBody,
            channelId: 'delulu_messages',
            icon: 'ic_stat_delulu',
            color: '#85431E',
            sound: 'default',
            defaultSound: true,
            defaultVibrateTimings: true,
            priority: 'max',
            visibility: 'public',
            // Critical: Use notificationPriority=PRIORITY_MAX for instant delivery
            notificationPriority: 'PRIORITY_MAX',
            tag: connectionId ? `conn_${connectionId}` : `notif_${Date.now()}`,
            // Wake the screen for incoming messages
            sticky: false,
            // Bypass doze mode restrictions
            bypassDoze: true
          }
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: notifTitle,
                body: notifBody
              },
              sound: 'default',
              badge: 1,
              'content-available': 1
            }
          }
        }
      };

      try {
        await fcmBreaker.execute(async () => {
          const response = await messaging.sendEachForMulticast(multicastMessage);
          dispatchResults.fcm += response.successCount;

          // Clean up invalid or unregistered tokens
          if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
              if (!resp.success && resp.error) {
                const errCode = resp.error.code;
                if (
                  errCode === 'messaging/registration-token-not-registered' ||
                  errCode === 'messaging/invalid-registration-token'
                ) {
                  const source = fcmTokenSources.get(tokens[idx]);
                  if (!source) return;
                  source.deviceIds.forEach(deviceId => {
                    unregisterDevice(receiverId, deviceId).catch(() => {});
                  });
                  if (source.legacy) {
                    pushOps.removeFCMToken(receiverId, tokens[idx]).catch(() => {});
                  }
                }
              }
            });
          }
        }, (err) => {
          console.warn('FCM circuit breaker triggered fast fallback:', err.message);
          dispatchResults.errors.push(`fcm_circuit_open: ${err.message}`);
        });
      } catch (fcmErr) {
        console.error('FCM Multicast error:', fcmErr.message);
        dispatchResults.errors.push(fcmErr.message);
      }
    }
  } else if (payload.type === 'chat_message') {
    console.warn(`No valid FCM tokens available for message notification to user ${receiverId}`);
  }

  // 4. Dispatch to Web Push devices + deduped legacy subscriptions
  const webTargets = [
    ...webDevices.map(dev => ({ subscription: dev.web_push_subscription, deviceId: dev.deviceId })),
    ...legacyWebSubs.map(sub => ({ subscription: { endpoint: sub.endpoint, keys: sub.keys }, deviceId: null }))
  ];
  for (const target of webTargets) {
    const subscription = target.subscription;
    if (!subscription || !subscription.endpoint) continue;
    // Note: the breaker's fallback swallows the error, so dead-subscription
    // cleanup must happen INSIDE the execute callback (not in an outer catch).
    await pushBreaker.execute(async () => {
      try {
        await sendWebPush(subscription, payload, connectionId);
        dispatchResults.web++;
      } catch (err) {
        // Expired/revoked subscription (410/404) — drop the device so we stop retrying it
        if (err && err._gone && target.deviceId) {
          unregisterDevice(receiverId, target.deviceId).catch(() => {});
        } else if (err && err._gone && !target.deviceId) {
          // Legacy subscription with no device doc — remove the stale push_subs row.
          pushOps.removeSubscription(subscription.endpoint, receiverId).catch(() => {});
        }
        throw err;
      }
    }, (err) => {
      console.warn('Web push circuit breaker caught error:', err.message);
    });
  }

  return { dispatched: true, results: dispatchResults };
}

module.exports = {
  registerDevice,
  unregisterDevice,
  getActiveDevices,
  dispatchNotification,
  configureWebPush,
  fcmBreaker,
  pushBreaker
};
