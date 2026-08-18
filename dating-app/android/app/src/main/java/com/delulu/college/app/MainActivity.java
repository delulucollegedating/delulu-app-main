package com.delulu.college.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
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

        // Create high-importance notification channel for Delulu messages (Android 8+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationChannel channel = new NotificationChannel(
                    "delulu_messages",
                    "Delulu Chat Messages",
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Notifications for incoming chat messages and connections");
                channel.enableVibration(true);
                channel.setShowBadge(true);
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
