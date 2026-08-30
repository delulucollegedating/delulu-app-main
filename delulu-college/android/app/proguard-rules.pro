# ── Delulu / Capacitor ProGuard Rules ─────────────────────────────────────────
#
# R8 strips classes that are only referenced via reflection or string names.
# Capacitor loads plugins this way, so we must explicitly keep them.

# ── Capacitor core & plugin bridge ────────────────────────────────────────────
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep class com.delulu.** { *; }

# ── Capacitor JS interface (WebView calls Java via this bridge) ───────────────
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Firebase Cloud Messaging ───────────────────────────────────────────────────
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# ── AndroidX / Jetpack (used by Capacitor internally) ─────────────────────────
-keep class androidx.** { *; }
-dontwarn androidx.**

# ── Kotlin metadata (needed for Kotlin interop to work after shrink) ───────────
-keep class kotlin.** { *; }
-keep class kotlinx.** { *; }
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes SourceFile,LineNumberTable

# ── Cordova plugin compatibility (Capacitor plugins may use Cordova internals) ─
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# ── Enum safety (R8 can break enum usage in some patterns) ────────────────────
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── Serializable classes (Capacitor passes objects across the bridge) ──────────
-keepclassmembers class * implements java.io.Serializable {
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# ── Suppress noisy warnings from optional dependencies ────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**

