# AGENTS.md — Delulu College Social Discovery Platform

> **Purpose**: This file gives any AI agent (Antigravity, Claude, Cursor, Copilot, ChatGPT) or human developer a 100% complete mental model of the Delulu project — its architecture, APK build workflows, data flows, database schemas, real-time mechanisms, security rules, and developer invariants — so **no source files need to be re-read before making changes**.

---

## 1. Project Overview & Core Philosophy

**Delulu** is a college-exclusive **social discovery and slow-connection platform** built for university students. Unlike generic swipe apps, Delulu prioritizes campus community trust, safety, gradual identity reveals, and interactive icebreakers.

### Core Product Pillars:
1. **Ecosystem Silos**: Students only discover and interact with peers from their own verified college email domain (`@rishihood.edu.in`, `@vitbhopal.ac.in`, etc.).
2. **"Say Hi" Connection Requests**: Direct requests with cursor-paginated discovery feed sorted by hobby compatibility.
3. **Connected Chat Only**: Direct messaging is only unlocked after mutual request acceptance.
4. **Interactive Icebreakers & Mini-Games**: Built-in games (`would_you_rather`, `this_or_that`, `question`) to spark meaningful conversations.
5. **10-Day Gradual Reveal Protocol**:
   - **Day 1–6**: Anonymous chat (avatars & pseudonyms).
   - **Day 7**: Mutual **Identity Reveal** unlocks (reveals real username, bio, hobbies upon mutual consent).
   - **Day 10–11 (24-Hour Window)**: Mutual **Face Reveal** unlocks (unlocks physical photo/video meeting code). If not completed within 24 hours, the chat automatically expires via background sweep.
6. **"Not Vibing" Graceful Exit**: Either user can terminate a chat anytime. Messages are soft-deleted (tombstoned) instantly from the UI and hard-deleted after 7 days (30 days if reported) by retention sweeps.
7. **Cross-Platform Delivery**: Mobile-first Web Application (MPA) packaged as an Android APK (and iOS IPA) via **Capacitor 8**, with direct in-app and web APK downloads (`/delulu.apk`).

---

## 2. Repository Layout & Topology

```
/Users/shubham/Documents/MAIN_DELULU/
├── AGENTS.md                      # Master Agent Blueprint
├── README.md                      # Project documentation & quickstart
├── APK_BUILD_GUIDE.md             # Complete Android APK & iOS build manual
├── ARCHITECTURE.md                # In-depth architectural & state-machine spec
├── firebase.json                  # Root Firebase config pointing to dating-app rules/indexes
├── .firebaserc                    # Firebase project configuration (delulu-final)
├── delulu.apk                     # Root copy of production Android release APK (18MB)
├── delulu.apk.idsig               # APK signature index scheme file
└── dating-app/                    # Full application repository
    ├── package.json               # Node 22+ dependencies, Capacitor 8, Tailwind, Vitest
    ├── capacitor.config.json      # Capacitor native runtime configuration
    ├── server.js                  # Master Express 5 server (REST API, SSE, Auth, Sweeps)
    ├── database.js                # Database operations (Firestore + Supabase + Caching)
    ├── firestore.rules            # Firestore security rules (Admin SDK bypass, client deny)
    ├── firestore.indexes.json     # Firestore composite index definitions
    ├── tailwind.config.js         # Tailwind CSS styling configuration
    ├── tailwind.input.css         # Tailwind entrypoint
    ├── vitest.config.js           # Vitest testing suite configuration
    ├── .env.example               # Complete environment variable template
    ├── android/                   # Native Android studio project (Capacitor wrapper)
    │   ├── app/build.gradle       # App Gradle config, release signing, Proguard
    │   ├── app/src/main/
    │   │   ├── AndroidManifest.xml # Permissions (Camera, Audio, Push, Storage), FCM config
    │   │   └── java/.../MainActivity.java # FLAG_SECURE screenshot block, Notification channels
    │   ├── keystore/              # Android release keystore location
    │   └── gradlew                # Gradle wrapper for CLI builds
    ├── ios/                       # Native iOS project (Capacitor wrapper)
    ├── builds/                    # Built APKs/IPAs (delulu.apk, delulu.ipa)
    ├── config/
    │   └── profanity.json         # Canonical 2-tier moderation dictionary
    ├── db/
    │   ├── supabase.js            # Supabase Postgres client + supabaseBreaker
    │   └── migrations/            # SQL migration scripts (20260802_chat_scale.sql)
    ├── services/
    │   ├── eventBus.js            # Cross-instance Redis Pub/Sub SSE fanout bridge
    │   ├── failoverStores.js      # Redis/Memory failover for sessions & rate limiters
    │   ├── notificationDispatcher.js # Multi-platform Push (FCM + Web Push + Presence)
    │   └── redisClient.js         # ioredis client with auto-reconnect
    ├── utils/
    │   ├── circuitBreaker.js      # CircuitBreaker class (Brevo, FCM, Push, Supabase)
    │   ├── emailQueue.js          # In-memory throttled queue for transactional emails
    │   ├── fragmentCache.js       # In-memory ecosystem/locale fragment cache
    │   └── profanity.js           # Server-side two-tier content moderation
    ├── scripts/
    │   ├── generate-profanity-client.js # Generates client-side profanity JS
    │   └── generate-release-keystore.sh # Generates Android release signing keystore
    ├── tests/                     # 18 comprehensive Vitest integration/unit test suites
    └── public/                    # Static Multi-Page Web App (MPA)
        ├── index.html             # Landing / redirect page
        ├── login.html             # Auth (Signup, Login, OTP verification, 2FA, Forgot PW)
        ├── discover.html          # Profile discovery feed (Cursor pagination, 3D avatars)
        ├── requests.html          # Incoming/sent connection requests & confetti match UI
        ├── messages.html          # Active chat list + Per-user SSE stream + Rich toasts
        ├── chat.html              # Chat room (SSE, Icebreakers, Reveals, Voice, E2EE)
        ├── profile.html           # Profile editor with optimistic rollback
        ├── settings.html          # Settings (Username cooldown, TOTP 2FA, PW reset)
        ├── sw.js                  # Service Worker (Web Push handler)
        ├── styles.css             # Compiled Tailwind & custom glassmorphism styles
        └── js/                    # Client-side JavaScript modules
            ├── shared.js          # Global helpers, auth tokens, client-side profanity
            ├── login.js           # Auth workflows & OTP verification
            ├── discover.js        # Discovery feed, hobby badges, swipe/connect actions
            ├── requests.js        # Request approvals, rejections, match celebrations
            ├── messages.js        # Chat list manager & real-time badge updates
            ├── chat.js            # Chat room logic, reveals, icebreaker mini-games
            ├── profile.js         # Profile management
            ├── settings.js        # Account settings, 2FA setup/disable
            ├── crypto.js          # Web Crypto API E2EE (ECDH P-256 + AES-GCM)
            ├── chat-cache.js      # Dexie.js IndexedDB offline message cache
            ├── avatar3d.js        # Three.js 3D avatar carousel
            ├── heart-bg.js        # Animated heart background
            └── image-compress.js  # Client-side image compression
```

---

## 3. Technology Stack & Infrastructure

| Layer | Technology | Details |
|---|---|---|
| **Runtime / Server** | Node.js (v22+) + Express (v5.2.1) | REST API, Server-Sent Events (SSE), background sweeps |
| **Primary Database** | Google Firebase Firestore | Users, connections, OTP codes, blocks, reports, device tokens |
| **Messages Database** | Supabase PostgreSQL | High-throughput chat messages, read receipts, soft-delete tombstones |
| **Session Store** | `connect-pg-simple` / `memorystore` | Persistent 30-day sessions on Supabase Postgres with memory fallback |
| **Mobile Runtime** | Capacitor 8 (`@capacitor/android`, `@capacitor/ios`) | Native WebView wrapper with native plugins & hardware acceleration |
| **Real-time Pipeline** | Server-Sent Events (SSE) + Redis Pub/Sub | Single-pipeline real-time updates with cross-instance cluster fanout |
| **Push Notifications** | FCM (Firebase Admin SDK) + Web Push (VAPID) | Multi-platform notification dispatcher with room-presence detection |
| **Transactional Email**| Brevo API v3 (Sendinblue) | OTP verification & password reset emails with CircuitBreaker & queue |
| **Caching Layers** | In-Memory (LRU/TTL) + Redis | Multi-tier caches: ecosystem candidates, feeds, auth, messages, receipts |
| **Security & Auth** | Dual Auth (Cookie + Bearer) + TOTP 2FA | httpOnly cookies for Web, HMAC Bearer in native Preferences for APK |
| **End-to-End Encryption**| Web Crypto API | ECDH P-256 key exchange + AES-GCM message encryption (PBKDF2 keys) |
| **Styling & UI** | Tailwind CSS v3.4 + Vanilla JS (MPA) | Glassmorphism, Three.js 3D models, smooth CSS animations |
| **Testing** | Vitest v4.1 + Supertest | 18 test suites covering API, auth, state machines, and resilience |

---

## 4. Mobile App & Android APK Architecture (CRITICAL)

### 4.1 Capacitor Configuration (`capacitor.config.json`)
- **App ID**: `com.delulu.college.app`
- **App Name**: `Delulu`
- **Web Directory**: `public`
- **Android Scheme**: `https`
- **API Base URL**: `https://delulu-app-main-production.up.railway.app`
- **Navigation Whitelist**: `delulu-app-main-production.up.railway.app`, `*.railway.app`, `*.onrender.com`

### 4.2 Native Android Enhancements (`MainActivity.java`)
1. **Privacy Protection (`FLAG_SECURE`)**:
   - `getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);`
   - Blocks screenshots and screen recordings across the Android app to safeguard student identity and chat privacy.
2. **Hardware Acceleration & WebView Tuning**:
   - DOM Storage and Database enabled.
   - `webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);`
   - `webView.setOverScrollMode(View.OVER_SCROLL_NEVER);`
3. **Notification Channels (Android 8.0+)**:
   - Creates `delulu_messages` channel with `IMPORTANCE_HIGH`, lights, vibration, and lockscreen visibility.

### 4.3 Permissions (`AndroidManifest.xml`)
- `INTERNET`, `ACCESS_NETWORK_STATE`: Network communication
- `POST_NOTIFICATIONS`, `VIBRATE`, `RECEIVE_BOOT_COMPLETED`: Push notifications
- `CAMERA`, `READ_MEDIA_IMAGES`: Profile photo and avatar selection
- `RECORD_AUDIO`: Voice note messaging

### 4.4 APK Build & Signing Workflow

```
Web Code (public/)
       │
       ▼ (npx cap copy android / npx cap sync android)
android/app/src/main/assets/public/
       │
       ▼ (./gradlew assembleRelease)
android/app/build/outputs/apk/release/app-release.apk
       │
       ▼ (Copied to builds/delulu.apk and root delulu.apk)
Served via GET /delulu.apk & GET /api/download-apk
```

#### Keystore Generation:
```bash
cd dating-app
bash scripts/generate-release-keystore.sh [YourPassword]
```
Creates `android/keystore/delulu-release.keystore` with alias `delulu`.

#### Build Commands:
```bash
# 1. Build CSS & sync assets
cd dating-app
npm run build:css
npx cap sync android

# 2. Build Release APK via Gradle CLI
cd android
./gradlew assembleRelease

# 3. Copy to deployment locations
cp app/build/outputs/apk/release/app-release.apk ../builds/delulu.apk
cp app/build/outputs/apk/release/app-release.apk ../../delulu.apk
```

#### APK Download Endpoints:
- `GET /delulu.apk` (Rate-limited via `apkLimiter`)
- `GET /api/download-apk` (Direct download alias)

---

## 5. Database Architecture & Schemas

### 5.1 Firebase Firestore (Identity & Relationships)

#### `users/{userId}`
```typescript
{
  id: number;                       // Auto-increment integer (from counters/users)
  username: string;                 // Display handle (3-20 chars, alphanumeric + _)
  gender: "male" | "female" | "other";
  email: string;                    // Verified college email
  passcode_hash: string;            // bcrypt hash (cost factor 10)
  bio: string;                      // Max 300 chars
  hobbies: string[];                // Max 10 items
  avatar: string;                   // Avatar ID (e.g. "female_01", "male_03")
  is_onboarded: 0 | 1;
  ecosystem: "rishihood" | "vitbhopal"; // Derived from email domain
  public_key?: string | null;       // Base64 ECDH P-256 public key (E2EE)
  encrypted_private_key?: string | null; // AES-GCM encrypted private key
  username_changed_at?: string | null; // ISO timestamp for 15-day cooldown
  token_version: number;            // Incremented on logout/PW reset to revoke tokens
  totp_enabled?: boolean;           // 2FA status
  totp_secret?: string;             // Base32 TOTP secret (stripped by sanitizeUser)
  totp_backup_codes?: string[];     // HMAC-SHA256 hashed backup codes
  created_at: string;               // ISO timestamp
}
```

#### `users/{userId}/devices/{deviceId}` (Subcollection)
```typescript
{
  platform: "android_fcm" | "web_push";
  fcm_token: string | null;
  web_push_subscription: { endpoint: string; keys: { p256dh: string; auth: string } } | null;
  app_version: string;
  device_model: string;
  created_at: string;
  last_active_at: string;
  active: boolean;
}
```

#### `connections/{connectionId}`
```typescript
{
  id: number;                       // Auto-increment integer (from counters/connections)
  from_user_id: number;             // Initiator user ID
  to_user_id: number;               // Recipient user ID
  status: "pending" | "accepted" | "rejected" | "expired" | "revealed";
  created_at: string;               // ISO timestamp
  chat_started_at: string | null;   // Timestamp when request was accepted
  
  // Day 7: Identity Reveal
  identity_reveal_available_at: string | null; // chat_started_at + 7 days
  from_identity_reveal: 0 | 1;
  to_identity_reveal: 0 | 1;

  // Day 10–11: Face Reveal (24-Hour Window)
  face_reveal_available_at: string | null;     // chat_started_at + 10 days
  face_reveal_expires_at: string | null;       // face_reveal_available_at + 24 hours
  from_face_reveal: 0 | 1;
  to_face_reveal: 0 | 1;
  face_reveal_declined_by: number | null;
  meeting_code: string | null;                 // Generated Google Meet code upon mutual reveal

  // Active Icebreaker Game
  active_game: {
    game_type: "would_you_rather" | "this_or_that" | "question";
    question: string;
    answers: Record<string, string>;           // { [userId]: answer }
    created_at: string;
  } | null;

  ended_reason: string | null;                 // "not_vibing" | "face_reveal_timeout" | "face_reveal_declined"
}
```

#### Other Firestore Collections:
- `active_connection_locks/{userId}`: Lock tracker for active connections
- `counters/{collectionName}`: Auto-increment sequence generator (`users`, `connections`)
- `blocked_users/{docId}`: `{ from_user_id, to_user_id, created_at }`
- `reported_users/{docId}`: `{ reporter_id, reported_user_id, reason, evidence, connection_id, created_at }`
- `otp_codes/{docId}`: `{ email, code_hash, created_at, expires_at, verified }`
- `client_logs/{docId}`: Client error logs (Rate limited to 10/min per IP)

---

### 5.2 Supabase PostgreSQL (High-Throughput Messages & Receipts)

#### Table: `public.messages`
```sql
CREATE TABLE public.messages (
  id              BIGSERIAL PRIMARY KEY,
  connection_id   INTEGER NOT NULL,
  sender_id       INTEGER NOT NULL,
  content         TEXT,
  reactions       JSONB DEFAULT '{}',     -- { "❤️": [1, 4], "😂": [2] }
  is_voice        INTEGER DEFAULT 0,      -- 0=text, 1=voice, 2=photo
  voice_duration  INTEGER DEFAULT 0,
  is_encrypted    INTEGER DEFAULT 0,      -- 0=plain, 1=E2EE
  iv              TEXT,                   -- AES-GCM IV for E2EE
  client_uuid     TEXT,                   -- Idempotency key from client
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,            -- Soft-delete tombstone (Kept for report evidence)
  deleted_by      INTEGER
);

CREATE INDEX messages_connection_created_at_idx ON public.messages (connection_id, created_at DESC);
CREATE UNIQUE INDEX messages_connection_sender_client_uuid_idx ON public.messages (connection_id, sender_id, client_uuid);
```

#### Table: `public.chat_read_receipts`
```sql
CREATE TABLE public.chat_read_receipts (
  connection_id BIGINT NOT NULL,
  user_id       BIGINT NOT NULL,
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, user_id)
);
CREATE INDEX chat_read_receipts_user_connection_idx ON public.chat_read_receipts (user_id, connection_id);
```

#### Table: `public.session` (Managed by `connect-pg-simple`)
```sql
CREATE TABLE public.session (
  sid    VARCHAR PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
```

---

## 6. Core Algorithms & Business Rules

### 6.1 Ecosystem Isolation Algorithm (MANDATORY)
```javascript
function getEcosystem(email) {
  const domain = email.split('@')[1];
  if (domain === 'vitbhopal.ac.in') return 'vitbhopal';
  return 'rishihood'; // Covers rishihood.edu.in, nst.rishihood.edu.in, psy, som, sod, soh
}
```
- **Invariant**: Discovery feeds MUST ALWAYS filter by `ecosystem === user.ecosystem`.
- Students from different universities **never see or connect with each other**.

### 6.2 Discovery Feed & Hobby Scoring
- **Candidates Cache**: `ecosystemCandidatesCache` (5-minute TTL).
- **Per-Viewer Feed Cache**: `discoverFeedCache` (10-minute TTL, max 500 entries).
- **Hobby Scoring**:
  - **+10 points** per shared hobby (case-insensitive)
  - **+5 points** if candidate profile has a bio > 10 characters
  - Sorted: `compatibilityScore DESC`, then `id ASC` (deterministic tie-breaker)
- **Signed Cursor Pagination**:
  - Encodes `{ u: userId, g: genderFilter, s: startIndex }` with HMAC-SHA256.
  - Returns 15 profiles per page. "View More" slices from cached feed snapshot with zero extra DB reads.

### 6.3 Connection Lifecycle & Timeline
```
[Discover Feed] ──► Send "Say Hi" ──► status: "pending"
                          │
[Requests Page] ──► Accept Request ──► status: "accepted"
                          │            (chat_started_at = NOW)
                          ▼
            Day 1–6: Anonymous Chat
            Day 7+: Identity Reveal Button Unlocks (Mutual agreement reveals username/bio)
            Day 10–11: Face Reveal Button Unlocks (24-Hour Window)
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
    Mutual Accept                   Decline or 24h Timeout
          │                               │
  status: "revealed"             status: "expired" / "rejected"
  Google Meet Code Generated     Soft-delete messages, unlock rediscover
```

### 6.4 30-Minute Background Sweeps
1. `connectionOps.sweepExpired()`:
   - Queries `accepted` connections in batches of 500.
   - If `face_reveal_expires_at < NOW` and not mutually revealed -> transitions to `expired`, deletes active locks, emits SSE `ended` event.
2. `connectionOps.sweepExpiredRequests()`:
   - Auto-expires `pending` requests older than 7 days.
3. Message Retention Hard-Delete Sweep:
   - Purges soft-deleted messages older than 7 days (or 30 days if associated with an active report).

### 6.5 Two-Tier Content Moderation
- **Dictionary**: `config/profanity.json`
- **Build Step**: `npm run generate:profanity` outputs `public/js/profanity-words.generated.js`.
- **Tier 1 (FORBIDDEN_WORDS)**: Substring matching (catches `$word$`, `abwordcd`). Includes university brand protection.
- **Tier 2 (FORBIDDEN_SHORT_TOKENS)**: Word-boundary matching (`\btoken\b`) to prevent false positives on substrings (`mac`, `Gandalf`).
- **E2EE Exception**: Encrypted messages are validated client-side before encryption; reports allow the user to submit decrypted text as safety evidence.

---

## 7. Real-Time & Event Dispatch Architecture

### 7.1 Server-Sent Events (SSE) Channels
1. **Per-Connection Stream** (`GET /api/connections/:id/stream`):
   - Events: `message`, `read`, `typing`, `presence`, `game`, `info`, `ended`, `face-declined`, `revealed`.
   - Heartbeat: `: heartbeat` comment sent every **25 seconds**.
   - Presence tracked in-memory: `activeRoomUsers.get(connId).add(userId)`.
2. **Per-User Stream** (`GET /api/user/stream`):
   - Events: `message` (chat row update + rich toast), `chat_ended`, `match_celebration`.
   - Heartbeat: Every 25 seconds.

### 7.2 Multi-Instance Redis EventBus (`services/eventBus.js`)
- Bridges local EventEmitters across multiple cluster processes/containers using Redis Pub/Sub (`sse:bus:*`).
- Local delivery occurs first (<1ms latency); publishes to Redis for cross-instance subscribers.
- Automatic failover: Operates in local-only mode if Redis is unavailable.

### 7.3 Notification Dispatcher (`services/notificationDispatcher.js`)
1. **Room Presence Check**: If recipient is actively inside the chat room via SSE, push notifications are skipped.
2. **Device Routing**:
   - Queries `users/{userId}/devices` subcollection.
   - Dispatches FCM multicast to Android devices.
   - Dispatches Web Push (VAPID) to browser subscriptions.
   - Stale/unregistered tokens (410 Gone / NotRegistered) are automatically cleaned from Firestore.
3. **Resilience**: Protected by `fcmBreaker` and `pushBreaker` CircuitBreakers.

---

## 8. Authentication, Dual-Session & Security Architecture

### 8.1 Dual Authentication Flow
- **Web Browsers**:
  - `express-session` using `httpOnly`, `Secure` (in prod), `SameSite=Lax` cookies.
  - Zero tokens stored in `localStorage`.
- **Capacitor Mobile (Android/iOS)**:
  - HMAC-signed Bearer token (`${userId}:${timestamp}:${hmac}`).
  - HMAC covers `userId:timestamp:token_version`.
  - Stored in **native `@capacitor/preferences`** (never in web localStorage).
  - Sent via `Authorization: Bearer <token>` header.
- **Instant Token Revocation**:
  - `token_version` on the Firestore user document is incremented on logout, password change, and password reset. All previous bearer tokens become invalid immediately.

### 8.2 Two-Factor Authentication (TOTP 2FA)
- Uses `otplib` v12 (`authenticator.options = { window: 1 }`).
- QR code setup via `qrcode` package.
- Single-use 8-character backup codes stored as HMAC-SHA256 hashes.
- Disabling 2FA requires verifying the current live TOTP code.

### 8.3 Rate Limiters & Failover Store (`services/failoverStores.js`)

| Limiter | Target Route | Window | Limit |
|---|---|---|---|
| `authLimiter` | `/api/users/login`, `/api/users/login/2fa` | 15 min | 5 attempts |
| `otpLimiter` | `/api/auth/send-verification-email`, `/api/auth/verify-otp` | 15 min | 10 attempts |
| `apiLimiter` | Global `/api/*` | 1 min | 300 (Authed) / 60 (Anon) |
| `messageLimiter` | `POST /api/messages/send` | 1 min | 120 messages |
| `discoverLimiter`| `GET /api/discover`, `POST /api/discover/dismiss` | 1 min | 120 requests |
| `apkLimiter` | `/delulu.apk`, `/api/download-apk` | 15 min | 30 downloads |

*Failover Store*: Dynamically uses Redis when ready; falls back to in-memory store seamlessly during Redis blips.

---

## 9. Comprehensive API Endpoint Reference

### Authentication & Account
- `POST /api/auth/send-verification-email` — Send signup OTP & signed link
- `POST /api/auth/verify-otp` — Verify signup OTP
- `POST /api/auth/verify-token` — Verify email token link
- `POST /api/auth/complete-profile` — Finalize onboarding & create user doc
- `POST /api/users/login` — User login (returns TOTP challenge if enabled)
- `POST /api/users/login/2fa` — Complete TOTP challenge
- `POST /api/users/logout` — Invalidate session and bump token version
- `GET  /api/users/me` — Fetch current user profile
- `POST /api/auth/forgot-password/send-code` — Send PW reset code
- `POST /api/auth/forgot-password/reset` — Verify code & reset password

### Discovery & Connections
- `GET  /api/discover` — Get cursor-paginated discover feed
- `POST /api/discover/dismiss` — Dismiss profile from feed
- `POST /api/connections/request` — Send "Say Hi" connection request
- `GET  /api/connections/requests` — List pending/sent requests
- `POST /api/connections/:id/respond` — Accept or reject request
- `GET  /api/connections/active` — List active accepted chats
- `GET  /api/connections/:id` — Fetch single connection state

### Chat & Messaging
- `GET  /api/connections/:id/stream` — SSE real-time stream for chat room
- `GET  /api/user/stream` — SSE stream for user notifications/chat list
- `GET  /api/connections/:id/messages` — Paginated chat messages
- `POST /api/messages/send` — Send text/voice/photo/E2EE message
- `POST /api/messages/react` — Add/remove emoji reaction
- `POST /api/messages/delete` — Soft-delete message
- `POST /api/connections/:id/read` — Update read receipt

### Icebreakers & Reveals
- `POST /api/connections/:id/start-game` — Start icebreaker mini-game
- `POST /api/connections/:id/answer-game` — Submit game answer
- `POST /api/connections/:id/clear-game` — Clear finished game
- `POST /api/connections/:id/identity-reveal` — Request/accept identity reveal
- `POST /api/connections/:id/face-reveal` — Request/accept face reveal
- `POST /api/connections/:id/face-reveal-decline` — Decline face reveal
- `POST /api/connections/:id/end` — "Not Vibing" end chat

### Settings & Devices
- `POST /api/settings/check-username` — Check username availability
- `POST /api/settings/update-username` — Update username (15-day cooldown)
- `GET  /api/settings/2fa` — Check 2FA status
- `POST /api/settings/2fa/setup` — Generate TOTP secret & QR code
- `POST /api/settings/2fa/verify` — Verify & enable 2FA
- `POST /api/settings/2fa/disable` — Disable 2FA with current code
- `POST /api/devices/register` — Register FCM or Web Push device

---

## 10. Developer Invariants & Hard Rules

1. **Ecosystem Isolation is Inviolable**: Never allow cross-ecosystem discovery or matching.
2. **Strict Database Division**:
   - **Firestore**: Users, connections, auth, devices, reports.
   - **Supabase PostgreSQL**: Chat messages, read receipts, sessions.
   - Never store chat messages in Firestore; never store connection status in Supabase.
3. **No Direct Firestore Client Calls**: All mutations go through `server.js` and `database.js` via Firebase Admin SDK.
4. **SSE is the Sole Real-Time Transport**: Do not introduce WebSockets without an architectural decision to avoid duplicate events and race conditions.
5. **Connection Ownership Validation**: Always verify user participation (`from_user_id === userId || to_user_id === userId`) before fulfilling any chat or connection action.
6. **Reveal Protocol Timelines**: Day 7 (Identity), Day 10 (Face Reveal), Day 11 (24h Expiry Sweep). Do not modify without updating server sweeps and client countdowns.
7. **APK Synchronization**: Always run `npm run build:css` and `npx cap sync android` after modifying any frontend files before building the native APK.
8. **Profanity Generation**: Modify `config/profanity.json` and run `npm run generate:profanity` — never edit generated files manually.
9. **Zero Plaintext Secrets**: Passwords hashed with bcrypt (cost 10), TOTP backup codes hashed with HMAC-SHA256, sensitive fields stripped by `sanitizeUser()`.
