package com.delulu.college.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            // Prevent screenshots and screen recording across the app for privacy
            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE
            );
        } catch (Exception e) {
            // Safe fallback if window flags fail on certain vendor ROMs
        }

        // Optimize WebView rendering speed and hardware acceleration
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setCacheMode(WebSettings.LOAD_DEFAULT);
                webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
                webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            }
        } catch (Exception e) {}

        // Create HIGH priority notification channel for Delulu messages (Android 8+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationChannel channel = new NotificationChannel(
                    "delulu_messages",
                    "Delulu Chat Messages",
                    NotificationManager.IMPORTANCE_HIGH  // HIGH priority - respects user DND settings
                );
                channel.setDescription("Notifications for incoming chat messages and connections");
                channel.enableVibration(true);
                channel.setShowBadge(true);
                channel.enableLights(true);
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                // REMOVED: setBypassDnd(true) - violates Play Store policy
                // Users can manually set notification exceptions in Android Settings if desired
                channel.setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION), null);

                NotificationManager manager = getSystemService(NotificationManager.class);
                if (manager != null) {
                    manager.createNotificationChannel(channel);
                }
            } catch (Exception e) {
                // Safe fallback if notification manager fails on custom ROM
            }
        }
    }
}
