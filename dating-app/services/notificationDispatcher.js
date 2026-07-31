const { getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const CircuitBreaker = require('../utils/circuitBreaker');
const { sendPushNotification } = require('../database');

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
  const apps = getApps();
  if (apps.length === 0) return null;
  return getMessaging(apps[0]);
}

/**
 * Register or update a device token for a user under users/{userId}/devices/{deviceId}
 */
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
  if (!userId) return [];
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

  // 1. Presence Check: If receiver is actively connected via SSE to this chat room, skip push
  if (typeof ssePresenceChecker === 'function' && ssePresenceChecker(receiverId, connectionId)) {
    return { dispatched: false, reason: 'user_active_in_sse_stream' };
  }

  // 2. Fetch registered devices for the receiver
  const devices = await getActiveDevices(receiverId);
  if (devices.length === 0) {
    // Fallback: If no subcollection devices exist yet, attempt fallback to legacy Supabase push_subscriptions for Web Push
    try {
      await pushBreaker.execute(async () => {
        await sendPushNotification(
          receiverId,
          payload.title || 'New Message',
          payload.body || 'Someone sent you a message',
          payload.url || `/chat.html?connection=${connectionId}`
        );
      }, (err) => {
        console.warn('Web push fallback circuit breaker caught error:', err.message);
      });
      return { dispatched: true, channel: 'web_push_fallback' };
    } catch (fbErr) {
      return { dispatched: false, reason: 'no_devices_and_fallback_failed' };
    }
  }

  const fcmDevices = devices.filter(d => d.platform === 'android_fcm' && d.fcm_token);
  const webDevices = devices.filter(d => d.platform === 'web_push');

  const dispatchResults = { fcm: 0, web: 0, errors: [] };

  // 3. Dispatch to Android FCM devices
  if (fcmDevices.length > 0) {
    const messaging = getMessagingInstance();
    if (messaging) {
      const tokens = fcmDevices.map(d => d.fcm_token);
      const multicastMessage = {
        tokens,
        data: {
          type: String(payload.type || 'chat_message'),
          connectionId: String(connectionId || ''),
          senderId: String(payload.senderId || ''),
          senderName: String(payload.senderName || 'Classmate'),
          messageId: String(payload.messageId || ''),
          createdAt: String(payload.createdAt || new Date().toISOString()),
          title: String(payload.title || 'New Message'),
          body: String(payload.body || 'Someone sent you a message')
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'delulu_messages',
            icon: 'ic_stat_delulu',
            color: '#a53b29',
            sound: 'default',
            tag: `conn_${connectionId}`,
            clickAction: 'OPEN_CHAT'
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
                  const badDevice = fcmDevices[idx];
                  if (badDevice && badDevice.deviceId) {
                    unregisterDevice(receiverId, badDevice.deviceId);
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
  }

  // 4. Dispatch to Web Push devices
  if (webDevices.length > 0) {
    for (const dev of webDevices) {
      try {
        await pushBreaker.execute(async () => {
          await sendPushNotification(
            receiverId,
            payload.title || 'New Message',
            payload.body || 'Someone sent you a message',
            payload.url || `/chat.html?connection=${connectionId}`
          );
          dispatchResults.web++;
        }, (err) => {
          console.warn('Web push circuit breaker caught error:', err.message);
        });
      } catch (webErr) {
        dispatchResults.errors.push(webErr.message);
      }
    }
  }

  return { dispatched: true, results: dispatchResults };
}

module.exports = {
  registerDevice,
  unregisterDevice,
  getActiveDevices,
  dispatchNotification,
  fcmBreaker,
  pushBreaker
};
