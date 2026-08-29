# Delulu — College Social Discovery Platform

<div align="center">

![Delulu Logo](dating-app/public/logo.png)

**A play-first, safer social discovery and gradual-reveal connection app for university students.**

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.2.1-blue.svg)](https://expressjs.com)
[![Firebase](https://img.shields.io/badge/Firebase-Firestore-orange.svg)](https://firebase.google.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-teal.svg)](https://supabase.com)
[![Capacitor](https://img.shields.io/badge/Capacitor-8.0-blueviolet.svg)](https://capacitorjs.com)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-yellow.svg)](https://vitest.dev)

</div>

---

## 📚 Essential Documentation Links

For agents and developers working on this codebase, refer to these comprehensive guides:

- 🤖 **[AGENTS.md](AGENTS.md)** — **Master Agent Blueprint** containing 100% of the project's mental model, architecture, database schemas, algorithms, and developer invariants.
- 📱 **[APK_BUILD_GUIDE.md](APK_BUILD_GUIDE.md)** — **Complete Android & iOS Build Guide** covering Capacitor 8, release keystores, Gradle compilation, `FLAG_SECURE`, and APK hosting.
- 🏗️ **[ARCHITECTURE.md](ARCHITECTURE.md)** — **Technical Architecture & Data Flows** detailing dual-database split, hybrid auth, SSE fanout, and circuit breaker resilience.

---

## 🌟 Key Features

1. **Campus Ecosystem Silos**: Students are strictly partitioned by verified college email domains (e.g. `@rishihood.edu.in`, `@vitbhopal.ac.in`). No cross-campus exposure.
2. **"Say Hi" & Match Flow**: Send connection requests with a cursor-paginated discovery feed ranked by hobby compatibility scoring.
3. **10-Day Slow Connection Protocol**:
   - **Days 1–6**: Anonymous chat with custom 3D avatars.
   - **Day 7**: Mutual **Identity Reveal** unlocks (username, bio, shared hobbies).
   - **Day 10–11**: Mutual **Face Reveal** unlocks (24-hour window to unlock Google Meet code).
4. **Interactive Icebreakers**: Built-in games (`would_you_rather`, `this_or_that`, `question`) to break the ice effortlessly.
5. **"Not Vibing" Graceful Exit**: Either partner can terminate chats at any time. Messages are soft-deleted from UI and cleaned up via retention sweeps.
6. **Native Android Privacy**: Built-in screenshot and screen recording blocking (`FLAG_SECURE`), biometric/TOTP 2FA, and hardware-accelerated WebView.

---

## 🚀 Quick Start & Development

### 1. Prerequisites
- **Node.js**: v22.x or later
- **Package Manager**: `npm`
- **Java JDK**: 17+ (for Android builds)
- **Android SDK / Android Studio** (for APK generation)

### 2. Installation
```bash
cd dating-app
npm install
```

### 3. Environment Configuration
Copy the template and configure your secrets:
```bash
cp .env.example .env
```

Key environment variables:
- `SESSION_SECRET`: 48+ random hex bytes
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`: Firebase Admin credentials
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`: Supabase Postgres access
- `BREVO_API_KEY`: Brevo email API key for OTPs
- `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`: Android APK signing keys

### 4. Running the Dev Server
```bash
cd dating-app
npm run dev
# Server starts on http://localhost:3000
```

### 5. Running Test Suites
```bash
cd dating-app
npm test
```

---

## 📱 Mobile APK Commands

```bash
# 1. Build and compile Tailwind CSS
npm run build:css

# 2. Sync web assets to native Android project
npx cap sync android

# 3. Build release APK
cd android && ./gradlew assembleRelease

# 4. Copy to root / builds
cp app/build/outputs/apk/release/app-release.apk ../builds/delulu.apk
cp app/build/outputs/apk/release/app-release.apk ../../delulu.apk
```

*For complete APK signing, troubleshooting, and device installation instructions, see [APK_BUILD_GUIDE.md](APK_BUILD_GUIDE.md).*

---

## 📐 High-Level Architecture

```
                       ┌───────────────────────────────┐
                       │     Delulu Clients (Web/APK)  │
                       └───────────────┬───────────────┘
                                       │
                         HTTP REST API │ SSE Real-Time Stream
                                       ▼
                       ┌───────────────────────────────┐
                       │  Express 5 Application Server │
                       │  (Dual-Auth, Rate Limiters)   │
                       └───────┬───────────────┬───────┘
                               │               │
            ┌──────────────────┴──┐         ┌──┴──────────────────┐
            │  Firebase Firestore │         │  Supabase Postgres  │
            ├─────────────────────┤         ├─────────────────────┤
            │  • Users & Avatars  │         │  • Messages & Voice │
            │  • Connections      │         │  • Read Receipts    │
            │  • Device Tokens    │         │  • Session Store    │
            │  • OTPs & Reports   │         │  • Soft-Deletes     │
            └─────────────────────┘         └─────────────────────┘
```

---

## 🛡️ Security Highlights

- **Dual-Auth Model**: Secure `httpOnly` `SameSite=Lax` cookies for Web; HMAC-signed Bearer tokens stored in native `@capacitor/preferences` for Android.
- **Instant Token Revocation**: `token_version` tracking in Firestore immediately revokes all existing mobile tokens upon logout or password reset.
- **Hardware Privacy**: Android `FLAG_SECURE` blocks screen captures and recording.
- **Two-Tier Content Moderation**: Server & client profanity filtering (`config/profanity.json`).
- **End-to-End Encryption**: Optional Web Crypto API (ECDH P-256 + AES-GCM).

---

## 📄 License & Distribution
Private & Proprietary — Delulu College Social Discovery Platform.
All rights reserved.
