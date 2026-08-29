package com.delulu.college.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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

        // Create MAX priority notification channel for Delulu messages (Android 8+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationChannel channel = new NotificationChannel(
                    "delulu_messages",
                    "Delulu Chat Messages",
                    NotificationManager.IMPORTANCE_MAX  // Changed from HIGH to MAX for instant delivery
                );
                channel.setDescription("Notifications for incoming chat messages and connections");
                channel.enableVibration(true);
                channel.setShowBadge(true);
                channel.enableLights(true);
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                // CRITICAL: Bypass Do Not Disturb for chat messages
                channel.setBypassDnd(true);
                // Allow sound even in priority-only mode
                channel.setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION), null);

                NotificationManager manager = getSystemService(NotificationManager.class);
                if (manager != null) {
                    manager.createNotificationChannel(channel);
                }
            } catch (Exception e) {
                // Safe fallback if notification manager fails on custom ROM
            }
        }

        // Request battery optimization exemption for instant notifications
        requestBatteryOptimizationExemption();
    }

    /**
     * Request to disable battery optimization (Doze mode) for this app.
     * This ensures FCM notifications arrive instantly even when the device is idle.
     * The user will see a system dialog asking to allow unrestricted battery usage.
     */
    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                String packageName = getPackageName();
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);

                // Check if already whitelisted
                if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                    // Show system dialog to request exemption
                    Intent intent = new Intent();
                    intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + packageName));
                    startActivity(intent);
                }
            } catch (Exception e) {
                // Safe fallback - app will work but notifications may be delayed
            }
        }
    }
}
