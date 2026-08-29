package com.delulu.college.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;

import java.util.Map;

/**
 * Custom FirebaseMessagingService that guarantees a system notification is shown
 * whenever an FCM message arrives — even when the app is killed.
 *
 * WHY THIS EXISTS:
 * Capacitor's default MessagingService delegates to PushNotificationsPlugin.sendRemoteMessage(),
 * which calls getPushNotificationsInstance(). When the app is killed, the plugin isn't loaded
 * yet (bridge is null), so the notification is silently stashed in a static field and never
 * displayed as a system notification. The user sees nothing in the notification bar.
 *
 * This service:
 * 1. ALWAYS shows a system notification for data+notification FCM messages (background & killed).
 * 2. Forwards to Capacitor's plugin when the bridge is alive (foreground JS listeners still fire).
 * 3. Forwards token refresh to Capacitor so the JS registration listener still works.
 */
public class DeluluMessagingService extends FirebaseMessagingService {

    private static final String TAG = "DeluluMessaging";
    private static final String CHANNEL_ID = "delulu_messages";

    /**
     * Called when an FCM message is received — whether the app is in foreground,
     * background, or completely killed.
     */
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Log.d(TAG, "FCM message received. from=" + remoteMessage.getFrom()
                + " hasNotification=" + (remoteMessage.getNotification() != null)
                + " dataKeys=" + remoteMessage.getData().keySet());

        // ── 1. Always try to show a system notification (works when app is killed) ──
        try {
            showSystemNotification(remoteMessage);
        } catch (Exception e) {
            Log.e(TAG, "Failed to show system notification", e);
        }

        // ── 2. Forward to Capacitor's plugin so JS listeners still fire ──
        // When the app is in foreground the plugin IS loaded and will fire
        // pushNotificationReceived → our shared.js listener shows the in-app toast.
        // When the app is killed the plugin is null; the message is stashed but
        // our system notification above already covers that case.
        try {
            PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
        } catch (Exception e) {
            Log.d(TAG, "Capacitor plugin not available (app likely killed), notification already shown by DeluluMessagingService");
        }
    }

    /**
     * Called when the FCM token is refreshed. Forward to Capacitor so the JS
     * registration listener re-registers the token with our server.
     */
    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        Log.d(TAG, "FCM token refreshed");

        try {
            PushNotificationsPlugin.onNewToken(token);
        } catch (Exception e) {
            Log.w(TAG, "Could not forward token to Capacitor plugin", e);
        }
    }

    /**
     * Build and display a system notification from an FCM message.
     * Extracts title/body/url/type/connectionId from the data payload (preferred)
     * or falls back to the notification payload.
     */
    private void showSystemNotification(RemoteMessage remoteMessage) {
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        // ── Ensure the notification channel exists (idempotent) ──
        ensureChannel(manager);

        // ── Extract notification content ──
        Map<String, String> data = remoteMessage.getData();
        RemoteMessage.Notification notif = remoteMessage.getNotification();

        String title   = getFromDataOrNotif(data, notif, "title",   "New Message");
        String body    = getFromDataOrNotif(data, notif, "body",    "You have a new message");
        String url     = data.getOrDefault("url",    "/messages.html");
        String type    = data.getOrDefault("type",   "notification");
        String connId  = data.getOrDefault("connectionId", "");
        String senderName = data.getOrDefault("senderName", "");

        // If body is blank, derive from type
        if (body == null || body.isEmpty()) {
            if ("chat_message".equals(type)) {
                body = "You have a new message";
            } else if ("connection_request".equals(type)) {
                body = "New connection request";
            } else if ("connection_accepted".equals(type)) {
                body = "Connection accepted!";
            } else {
                body = "You have a new notification";
            }
        }

        // ── Handle encrypted messages ──
        String isEncrypted = data.getOrDefault("isEncrypted", "false");
        if ("true".equals(isEncrypted) || "1".equals(isEncrypted)) {
            body = "Encrypted message";
        }

        // ── Build the tap intent → opens MainActivity which routes via URL ──
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // Pass routing data so MainActivity / JS can navigate to the right page
        intent.putExtra("notification_url", url);
        intent.putExtra("notification_type", type);
        intent.putExtra("connectionId", connId);
        intent.putExtra("google.message_id", remoteMessage.getMessageId());

        int requestCode = (int) (System.currentTimeMillis() % Integer.MAX_VALUE);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // ── Build the notification ──
        Uri defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_delulu)
                .setContentTitle(senderName != null && !senderName.isEmpty() ? senderName : title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setSound(defaultSound)
                .setVibrate(new long[]{0, 250, 250, 250})
                .setLights(Color.parseColor("#85431E"), 500, 500)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setColor(Color.parseColor("#85431E"));

        // Use a stable tag for chat messages so duplicates collapse
        String tag = null;
        int notifId = requestCode;
        if (connId != null && !connId.isEmpty()) {
            tag = "conn_" + connId;
            notifId = connId.hashCode() & 0x7FFFFFFF;
        }

        if (tag != null) {
            manager.notify(tag, notifId, builder.build());
        } else {
            manager.notify(notifId, builder.build());
        }

        Log.d(TAG, "System notification shown: title=" + title + " type=" + type);
    }

    /**
     * Ensure the notification channel exists with MAX importance.
     * Called on every notification so it's always ready — no-op if already created.
     */
    private void ensureChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
            if (channel == null) {
                channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Delulu Messages",
                        NotificationManager.IMPORTANCE_MAX
                );
                channel.setDescription("Chat message and connection notifications");
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{0, 250, 250, 250});
                channel.enableLights(true);
                channel.setLightColor(Color.parseColor("#85431E"));
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                channel.setBypassDnd(true);
                channel.setSound(
                        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                        new android.media.AudioAttributes.Builder()
                                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build()
                );
                manager.createNotificationChannel(channel);
            }
        }
    }

    /**
     * Extract a field from the data map, falling back to the notification payload,
     * then to a default value.
     */
    private String getFromDataOrNotif(Map<String, String> data,
                                      RemoteMessage.Notification notif,
                                      String key, String defaultVal) {
        // Prefer data payload (always present when server sends both)
        String val = data.get(key);
        if (val != null && !val.isEmpty()) return val;

        // Fall back to notification payload
        if (notif != null) {
            if ("title".equals(key) && notif.getTitle() != null) return notif.getTitle();
            if ("body".equals(key)  && notif.getBody()  != null) return notif.getBody();
        }

        return defaultVal;
    }
}
