# AGENTS.md — Delulu College Social Discovery App

> **Purpose**: This file gives any AI agent (or developer) a complete mental model of the Delulu project — its architecture, data flows, algorithms, and rules — so no code needs to be read before making changes.

---

## 1. Project Overview

**Delulu** is a college-focused **social discovery and chat app** built for students from the same college/community. It is a safer, play-first "meet new people from your college" platform — not a swipe-first dating app.

### Core Product Pillars:
1. **Classmate Discovery**: Discover classmates from your university/community through profiles, hobbies, and gender filters.
2. **"Say Hi" Connection Requests**: Send connection requests to classmates to initiate mutual connections.
3. **Connected Chat Only**: Users can chat only after both users accept the connection request.
4. **Icebreakers & Mini-Games**: Built-in interactive icebreakers (`would_you_rather`, `this_or_that`, `question`) start conversations naturally.
5. **Gradual Identity & Face Reveals**: Identities remain anonymous by design. Day 7 unlocks mutual **Identity Reveal** (username/bio). Day 10 unlocks **Face Reveal** (physical identity) — valid for only a **24-hour window**. Both reveals require mutual consent.
6. **Time-Bound Chats**: Connections that don't complete a face reveal in the Day 10–11 window are automatically expired by a background sweep.
7. **"Not Vibing" Termination**: Either user can gracefully end a chat at any time. All messages are instantly purged from Supabase on end.

**Live URL**: https://delulu-college.onrender.com
**Android APK**: Served via `/delulu.apk` or `/api/download-apk` (built from `builds/delulu.apk` — gitignored, 126MB, distribute manually)
**Stack**: Node.js + Express (server), Firestore (users/connections), Supabase Postgres (messages/sessions/read-receipts), Capacitor (Android wrapper), Vanilla JS + Tailwind CSS (frontend)

---

## 2. Tech Stack & Infrastructure

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Server | Express.js (Node 22+) | REST API + SSE |
| Logging | `pino` + `pino-http` | Structured JSON logging (replaces console.log) |
| Compression | `compression` (Gzip / Brotli) | Responses >= 512 bytes (skips SSE & pre-compressed media) |
| Fault Resilience | `CircuitBreaker` (`utils/circuitBreaker.js`) | Protects Brevo Email, Push (Web+FCM), FCM APIs |
| Primary DB | Firebase Firestore | Users, connections, OTPs, block/report, client logs |
| Messages DB | Supabase Postgres | All chat messages (high-write), read receipts |
| Sessions | `connect-pg-simple` -> Supabase | Persistent 30-day sessions via `SUPABASE_DB_URL` |
| Session Fallback | `memorystore` | In-memory sessions if no `SUPABASE_DB_URL` |
| Auth (Hybrid) | Cookie session + HMAC Bearer token | Cookies for browsers, token for Capacitor Android |
| Real-time | SSE (`/api/connections/:id/stream`) | Per-connection live events (message, typing, presence, game) |
| Per-user RT | SSE (`/api/user/stream`) | Messages list live updates, rich toast notifications |
| Push (Web) | Web Push (VAPID) + `web-push` library | Browser push notifications |
| Push (Android) | Firebase Cloud Messaging (FCM) via Admin SDK | Native Android background push notifications |
| Notification Dispatcher | `services/notificationDispatcher.js` | Unified FCM + Web Push dispatch with presence check |
| Email | Brevo API (via `fetch`) | OTP verification + password reset emails |
| Hosting | Render.com (free tier) / Cloud Run | Auto-sleep when idle (Render); serverless (Cloud Run) |
| Android | Capacitor 8 (WebView wrapper) | APK from web codebase |
| E2EE | Web Crypto API (AES-GCM + ECDH P-256) | Optional end-to-end encrypted messages |
| Profanity Filter | `config/profanity.json` canonical source | Two-tier content moderation for server and browser |
| Fragment Cache | `utils/fragmentCache.js` | In-memory ecosystem/locale-keyed response fragment cache |

---

## 3. File Structure

```
dating-app/
├── server.js                  # All API routes (~2900 lines)
├── database.js                # All Firestore + Supabase operations (~2200 lines)
├── db/supabase.js             # Supabase client (service-role, server-only) + supabaseBreaker
├── utils/
│   ├── circuitBreaker.js      # CircuitBreaker fault isolation class
│   ├── fragmentCache.js       # In-memory page-fragment/ecosystem cache (60s TTL)
│   └── profanity.js           # Two-tier chat content moderation filter
├── services/
│   └── notificationDispatcher.js  # Multi-platform push notification dispatcher (FCM + Web Push)
├── firestore.rules            # Firestore security rules
├── firestore.indexes.json     # Firestore composite index definitions
├── capacitor.config.json
├── android/                   # Capacitor Android project
├── builds/                    # Android APK builds (gitignored)
└── public/
    ├── login.html             # Auth page (signup + OTP + login + forgot password)
    ├── discover.html          # Profile discovery (cursor-paginated feed with hobby scoring)
    ├── requests.html          # Pending/sent connection requests
    ├── messages.html          # Active chats list (per-user SSE)
    ├── chat.html              # Individual chat room (SSE + games + reveals)
    ├── profile.html           # Edit own profile (avatar, bio, hobbies)
    ├── settings.html          # Account settings (username change, password reset)
    ├── sw.js                  # Service Worker (web push notification handler)
    ├── styles.css             # Global Tailwind CSS styles
    └── js/
        ├── shared.js          # Global utilities, auth, navigation, profanity matching
        ├── profanity-words.generated.js # Generated browser word list
        ├── login.js           # Signup/login/OTP/forgot-password flow
        ├── discover.js        # Discovery + cursor-paginated feed + connect/dismiss logic
        ├── requests.js        # Accept/reject request UI + match-celebration confetti
        ├── messages.js        # Chat list + per-user SSE stream + rich toast notifications
        ├── chat.js            # Full chat room (messages, games, reveals, voice, E2EE)
        ├── profile.js         # Profile edit with optimistic rollback
        ├── settings.js        # Settings page (username cooldown, password reset flow)
        ├── crypto.js          # E2EE (Web Crypto API — AES-GCM + ECDH)
        ├── chat-cache.js      # IndexedDB message cache (Dexie.js offline support)
        ├── avatar3d.js        # Three.js 3D avatar carousel for discover page
        ├── heart-bg.js        # Animated heart particle background (login page)
        ├── image-compress.js  # Client-side image compression before upload
        └── dexie.min.js       # Dexie.js (IndexedDB wrapper, bundled)
```

---

## 4. Database Architecture

### 4.1 Firestore Collections

#### `users/{userId}`
```js
{
  id: Number,                    // auto-incremented integer (from counters/users)
  username: String,              // display name (3-20 chars, alphanumeric + underscore)
  gender: "male"|"female"|"other",
  email: String,                 // college email (determines ecosystem)
  passcode_hash: String,         // bcrypt hash (cost factor 10)
  bio: String,                   // max 300 chars
  hobbies: String[],             // max 10, each max 30 chars
  avatar: String,                // e.g. "female_01" or "male_03"
  is_onboarded: 0|1,
  ecosystem: "rishihood"|"vitbhopal", // derived from email domain
  public_key: String|null,       // ECDH P-256 public key (base64) for E2EE
  encrypted_private_key: String|null, // AES-GCM encrypted ECDH private key
  username_changed_at: ISO8601|null,  // used to enforce 15-day username cooldown
  created_at: ISO8601
}
```

#### `users/{userId}/devices/{deviceId}` (subcollection)
```js
{
  platform: "android_fcm"|"web_push",
  fcm_token: String|null,
  web_push_subscription: {
    endpoint: String,
    keys: { p256dh: String, auth: String }
  }|null,
  app_version: String,
  device_model: String,
  created_at: ISO8601,
  last_active_at: ISO8601,
  active: Boolean
}
```

#### `connections/{connectionId}`
```js
{
  id: Number,
  from_user_id: Number,            // who sent the request
  to_user_id: Number,              // who received the request
  status: "pending"|"accepted"|"rejected"|"expired"|"revealed",
  created_at: ISO8601,
  chat_started_at: ISO8601|null,
  // Day 7: Identity Reveal
  identity_reveal_available_at: ISO8601|null,  // chat_started_at + 7 days
  from_identity_reveal: 0|1,
  to_identity_reveal: 0|1,
  // Day 10: Face Reveal (24-hour window)
  face_reveal_available_at: ISO8601|null,      // chat_started_at + 10 days
  face_reveal_expires_at: ISO8601|null,        // face_reveal_available_at + 24 hours (Day 11)
  from_face_reveal: 0|1,
  to_face_reveal: 0|1,
  face_reveal_declined_by: Number|null,
  meeting_code: String|null,
  // Icebreak Game (stored inline, one active at a time)
  active_game: {
    game_type: "would_you_rather"|"this_or_that"|"question",
    question: String,
    answers: { [userId]: String },
    created_at: ISO8601
  }|null,
  ended_reason: String|null  // controlled values in CONNECTION_END_REASONS
}
```

#### `active_connection_locks/{userId}`
Written on connection accept, deleted on end/expire/reveal. Structural metadata for lock tracking.

#### `counters/{collectionName}`
Auto-incrementing integer ID generator for `users` and `connections` collections.

#### `blocked_users/{docId}`
`{ from_user_id, to_user_id, created_at }`

#### `reported_users/{docId}`
`{ reporter_id, reported_user_id, reason, connection_id, created_at }`

#### `otp_codes/{docId}`
`{ email, code_hash, created_at, expires_at, verified: bool }`

#### `client_logs/{docId}`
Client-side error logs. Rate-limited to 10 per IP per minute via `POST /api/log-error`.

---

### 4.2 Supabase Postgres Tables

#### `messages`
```sql
id              BIGSERIAL PRIMARY KEY
connection_id   INTEGER NOT NULL
sender_id       INTEGER NOT NULL
content         TEXT
reactions       JSONB DEFAULT '{}'      -- { "emoji": [userId, ...] }
is_voice        INTEGER DEFAULT 0       -- 0=text, 1=voice, 2=photo
voice_duration  INTEGER DEFAULT 0
is_encrypted    INTEGER DEFAULT 0       -- 0=plain, 1=E2EE
iv              TEXT                    -- AES-GCM IV for E2EE
client_uuid     TEXT                    -- idempotency key (prevents duplicate sends on retry)
created_at      TIMESTAMPTZ DEFAULT NOW()
deleted_at      TIMESTAMPTZ             -- soft-delete tombstone
deleted_by      INTEGER
```

#### `read_receipts`
```sql
connection_id   INTEGER NOT NULL
user_id         INTEGER NOT NULL
last_read_at    TIMESTAMPTZ NOT NULL
PRIMARY KEY (connection_id, user_id)
```
Read receipt data was migrated OUT of Firestore's `from_last_read_at`/`to_last_read_at` fields to avoid hot-document write amplification. Server uses `readReceiptOps.getForConnection()` for lookups and `readReceiptOps.markRead()` for writes (with 10s coalescing guard).

#### `push_subscriptions` (legacy)
```sql
user_id        INTEGER
endpoint       TEXT
keys           JSONB    -- { p256dh, auth }
created_at     TIMESTAMPTZ
```
Legacy path used by `pushOps.subscribe()`. New registrations go to the `users/{userId}/devices` Firestore subcollection via `notificationDispatcher.registerDevice()`.

#### `session` (auto-created by connect-pg-simple)
```sql
sid     VARCHAR PRIMARY KEY
sess    JSON
expire  TIMESTAMPTZ
```
RLS + public schema permission revoke applied automatically at startup.

---

## 5. Core Algorithms & Workflows

### 5.1 Ecosystem Algorithm (CRITICAL — DO NOT CHANGE)
Users are siloed into **ecosystems** based on their college email domain. Users from different ecosystems **never see each other** in discover.

```js
function getEcosystem(email) {
  const domain = email.split('@')[1];
  if (domain === 'vitbhopal.ac.in') return 'vitbhopal';
  return 'rishihood'; // default for nst.rishihood.edu.in, psy, som, sod, soh, etc.
}
```

**Allowed email domains** (validated at signup & password reset):
`rishihood.edu.in`, `vitbhopal.ac.in`, `nst.rishihood.edu.in`, `psy.rishihood.edu.in`, `som.rishihood.edu.in`, `sod.rishihood.edu.in`, `soh.rishihood.edu.in`

Discovery query ALWAYS filters by `ecosystem === userEcosystem`. This is the core isolation mechanism.

---

### 5.2 Discovery Algorithm (Signed Cursor Pagination + Hobby Scoring)

**Two-layer cache + signed cursor approach:**

**Layer 1: Ecosystem Candidates Cache** (`ecosystemCandidatesCache` in `database.js`)
- Caches all users in an ecosystem for **5 minutes** (keyed by `ecosystem:genderFilter`)
- Shared across all viewers in same ecosystem — eliminates repeated Firestore full-reads
- Invalidated on: user profile update, user registration

**Layer 2: Per-Viewer Discover Feed Cache** (`discoverFeedCache` in `server.js`)
- Caches the full sorted & scored candidate list per viewer for **10 minutes** (max 500 entries)
- All pagination pages read from this snapshot without rebuilding
- Invalidated on: connect request sent, dismiss, request accepted/rejected, profile change

**Hobby Compatibility Scoring** (computed in `database.js` -> `userOps.getDiscoverable`):
- **+10 pts** per shared hobby (case-insensitive)
- **+5 pts** if the profile has a bio > 10 chars
- Sorted: `compatibilityScore DESC`, then `id ASC` (stable numeric tie-breaker)

**Cursor Pagination** (`server.js` -> `GET /api/discover`):
1. First load (no cursor): build feed, cache it, return 15 profiles + signed cursor
2. Cursor = signed HMAC-SHA256 base64url encoding `{ u: userId, g: genderFilter, s: startIndex }`
3. "View More": validate cursor (wrong user or tampered -> HTTP 400), slice `feed.profiles[start..start+15]`
4. `hasMore: true/false` + `nextCursor` returned in every response

**Discovery Exclusions** (applied dynamically per viewer, not cached):
- Self
- Users with `pending`, `accepted`, or `revealed` status connections
- Blocked users (bidirectional)
- **NOT excluded**: `rejected` or `expired` connections — reappear for reconnection

**Three-level Firestore Query Fallback** (prevents HTTP 500 on missing indexes):
1. `ecosystem + gender` composite query
2. `ecosystem`-only query + in-memory gender filter
3. Full collection scan + in-memory ecosystem + gender filter

---

### 5.3 Connection Lifecycle (10-DAY SLOW DATING) — CRITICAL

```
[Discover] -> Send Request  ->  status: "pending"
                               (dismiss creates "rejected" record to prevent re-show)
    |
[Requests page] -> Accept  ->  status: "accepted"
    - chat_started_at = NOW
    - identity_reveal_available_at = NOW + 7 days
    - face_reveal_available_at = NOW + 10 days
    - face_reveal_expires_at = NOW + 11 days (24h window)
    |
[Chat] Day 1-6: Anonymous chat only
    - Countdown to Day 7 identity reveal shown in status subtext
    |
[Chat] Day 7+: "Let's Reveal" (Identity Reveal) button unlocks
    - Both users must click to reveal username, bio, hobbies
    - First user to click: "Waiting for the other person..."
    - When both agree -> status stays "accepted", identities revealed
    |
[Chat] Day 10-11: "Face Reveal" button unlocks (24-hour window)
    - Both users must click to initiate face reveal
    - DECLINE -> status: "rejected", ended_reason: "face_reveal_declined"
    - After decline, other user can end via "end-after-decline"
    - Both agree -> meeting_code generated -> status: "revealed" -> Google Meet
    - Neither acts within 24h -> background sweep sets status: "expired"
    |
[Ended] "Not Vibing" at any time -> status: "rejected", ended_reason: "not_vibing"
    - All Supabase messages DELETED immediately
    - Both users' SSE streams: "ended" event (chat) + "chat_ended" (messages list)
    - Discover feeds for both users invalidated -> can rediscover each other
```

**Reconnection**: After `rejected` or `expired`, either user can send a new request. The existing connection document is reused (`reconnected: true`) — all fields reset to `pending`.

**No exclusive pairing**: Users may hold multiple active chats simultaneously. `active_connection_locks` are structural metadata, not enforced blocking.

---

### 5.4 Background Sweep (Every 30 Minutes)

`connectionOps.sweepExpired()` runs on a 30-minute `setInterval`:
- Paginates all `accepted` connections in batches of 500 (`orderBy('__name__')`)
- **Identity reveal tracking**: Counts connections past Day 7 where neither user revealed (metric only — chat continues)
- **Face reveal expiry**: If `face_reveal_expires_at < now` AND either user hasn't clicked -> set `status: "expired"`, `ended_reason: "face_reveal_timeout"`, delete active locks
- Emits `ended` SSE event to both users' chat streams + `chat_ended` to messages list streams
- All `evictConnection()` calls happen immediately for each expired doc

`connectionOps.sweepExpiredRequests()` also runs every 30 minutes and expires old `pending` requests.

---

### 5.5 Icebreak Game Algorithm (CRITICAL — DO NOT CHANGE)

Three game types: `would_you_rather`, `this_or_that`, `question`.

**Deduplication lock** (`connectionOps.startGame`): If an `active_game` exists, was created within **30 seconds**, and has fewer than 2 answers -> return existing game. Prevents both users tapping simultaneously.

**Clear-game idempotency**: `POST /api/connections/:id/clear-game` passes `game_created_at`. Server only clears if the current `active_game.created_at` still matches. Prevents stale timeouts from removing a newly started game.

**Answer flow**:
1. User A starts game -> `active_game` written to Firestore connection doc
2. Both users see game card (via SSE `type: "game"` + Firestore onSnapshot listener)
3. User A answers -> `active_game.answers[userAId]` written
4. User B answers -> `active_game.answers[userBId]` written, `bothAnswered: true` returned
5. Client auto-clears game after reveal animation delay

---

### 5.6 E2EE Algorithm (Optional — per user pair)
Using browser-native Web Crypto API:
1. **Key Generation**: On registration, generate ECDH P-256 key pair
2. **Key Storage**: Public key -> Firestore `users/{id}.public_key`; private key -> AES-GCM encrypted with user password via PBKDF2 (100,000 iterations) -> `users/{id}.encrypted_private_key`
3. **Shared Secret**: When chat opens, derive ECDH shared secret from own private key + partner's `other_public_key`
4. **Encryption**: AES-GCM with random 128-bit IV; ciphertext in `content`, IV in `iv` column
5. **Flag**: `is_encrypted: 1` on encrypted messages; server skips profanity scanning (client blocks pre-encryption)
6. **Password Change**: Client must re-encrypt private key with new password and send `encrypted_private_key` in the settings update call

---

### 5.7 Authentication Flow

**Signup (new user)**:
1. `POST /api/auth/send-verification-email` -> sends 6-digit OTP + signed 1-hour verify link via Brevo
2. `POST /api/auth/verify-otp` OR `POST /api/auth/verify-token` -> saves `req.session.pendingEmail`
3. `POST /api/auth/complete-profile` -> validates `pendingEmail === email`, creates Firestore user doc, sets session

**Login (existing user)**:
- `POST /api/users/login` (username or email + password) -> bcrypt compare -> sets session + generates HMAC Bearer token

**Token-based auth (Capacitor Android)**:
- `generateAuthToken(userId)` -> `"${userId}:${timestamp}:${HMAC}"` (30-day TTL)
- Sent as `Authorization: Bearer <token>` header
- Middleware populates `req.session.userId` from token if cookie missing

**Password Reset (logged out)**:
- `POST /api/auth/forgot-password/send-code` -> sends OTP
- `POST /api/auth/forgot-password/reset` -> verifies OTP, hashes new password, auto-logs in user

**Password Reset (in Settings, logged in)**:
- `POST /api/settings/password-reset/send-code` -> sends OTP to linked email
- `POST /api/settings/password-reset/verify-and-update` -> verifies OTP, updates hash + re-encrypted E2EE key

**Username Change**:
- 15-day cooldown enforced server-side via `username_changed_at` field
- `POST /api/settings/check-username` -> real-time availability check
- `POST /api/settings/update-username` -> updates Firestore + invalidates all discover feeds

---

### 5.8 Notification Dispatch Architecture

Chat message notifications go through `notificationDispatcher.dispatchNotification()`:
1. **SSE Presence Check**: If receiver is in that chat room via SSE (`activeRoomUsers.get(connId).has(receiverId)`) -> skip push entirely
2. **Modern path**: Fetch `users/{userId}/devices` subcollection
   - FCM devices -> `messaging.sendEachForMulticast()` (batched, dead tokens auto-cleaned)
   - Web Push devices -> `webPush.sendNotification()` per subscription (dead 410/404 auto-cleaned)
3. **Legacy fallback**: If no subcollection devices, try `push_subscriptions` Supabase table
4. Circuit breakers: `fcmBreaker` (5s timeout, 3 failures) + `pushBreaker` (5s timeout, 3 failures)

Non-message notifications (connection request, acceptance) use `sendPushNotification()` in `server.js`, which checks both modern + legacy paths.

---

## 6. Real-Time Architecture

### 6.1 SSE (Primary Real-Time Channel)

**Per-connection SSE** (`GET /api/connections/:id/stream`):
- Opened by chat.js when user enters a chat room
- Registers in-memory presence: `activeRoomUsers.get(connId).add(userId)`
- Event types via `connectionEmitter.emit('update:{connId}', event)`:
  - `message` — new chat message (full msg object embedded, zero extra round-trips)
  - `read` — read receipt acknowledgement
  - `typing` — typing indicator
  - `presence` — online/offline status of room participants
  - `game` — icebreaker game state change
  - `info` — informational status message
  - `ended` — chat ended (not_vibing, expired, declined)
  - `face-declined` — partner declined face reveal
  - `revealed` — both face revealed, meeting_code included
- Heartbeat: `: heartbeat` comment every **25 seconds** (prevents Render/proxy timeout)
- Cleanup on `req.on('close')`: removes presence, unsubscribes listener, clears heartbeat interval

**Per-user SSE** (`GET /api/user/stream`):
- Opened by messages.js when user views their chat list
- Event types via `userEmitter.emit('user:{userId}', event)`:
  - `message` — new message arrived (updates chat row, shows rich toast)
  - `chat_ended` — a chat was ended (removes/updates row)
  - `match_celebration` — connection request accepted (triggers match confetti celebration)
- Heartbeat: `: heartbeat` every **25 seconds**
- Max listeners: `userEmitter.setMaxListeners(200)`

### 6.2 Real-time Transport

SSE is the sole real-time transport. Do not add a WebSocket/Socket.io fallback
without an explicit product decision: two event pipelines cause duplicate events
and ordering races.

---

## 7. In-Memory Caching Architecture

| Cache | Location | TTL | Invalidation |
|-------|----------|-----|-------------|
| `sessionCache` (user profiles) | `server.js` | 30 seconds | On profile update, logout |
| `discoverFeedCache` (per-viewer ordered feed) | `server.js` | 10 minutes | On connect, dismiss, accept, profile change |
| `connectionAuthCache` (connection ownership) | `server.js` | 30 seconds | On connection status change |
| `userByIdCache` (Firestore user docs) | `database.js` | 10 minutes | On `userOps.update()` |
| `ecosystemCandidatesCache` (all ecosystem users) | `database.js` | 5 minutes | On user create/update |
| `_connCache` (connection docs, LRU max 10k) | `database.js` | 2 minutes | `updateConnection()` / `updateConnections()` after successful commits |
| `_lastMessageCache` (last Supabase message per chat) | `database.js` | 15 seconds | `evictLastMessage()` |
| `_readReceiptCache` (last read timestamps) | `database.js` | 15 seconds | `setCachedReceipt()` |

**`_connCache` mutation rule (IMPORTANT)**: Never write a connection document directly. Route single writes/transactions through `updateConnection(connectionId, mutation)` and batches through `updateConnections(connectionIds, mutation)`. They evict the reverse-indexed cache only after the Firestore operation succeeds.

---

## 8. Security Architecture

### Rate Limiting

| Limiter | Route | Window | Max |
|---------|-------|--------|-----|
| `authLimiter` | Login | 15 min | 5 |
| `otpLimiter` | OTP send/verify | 15 min | 10 (keyed by email) |
| `apiLimiter` | All `/api/` | 1 min | 300 (authed) / 60 (anon) |
| `messageLimiter` | Send message | 1 min | 120 |
| `typingLimiter` | Typing indicator | 1 min | 60 |
| `gameLimiter` | Game actions | 1 min | 30 |
| `readReceiptLimiter` | Mark read | 1 min | 24 |
| `discoverLimiter` | Discover/dismiss | 1 min | 120 |

Rate limit identity: `user:{id}` if authenticated, otherwise `ip:{ip}`. Campus Wi-Fi (shared IP) won't throttle students unfairly.

### CSRF Protection
Custom middleware blocks `POST/PUT/DELETE/PATCH` from cross-origin non-Capacitor origins:
- Allows: `localhost`, `capacitor://localhost`, `file://` (Android native)
- Blocks: `sec-fetch-site: cross-site`, hostname mismatch

### Other Security
- **Helmet** with CSP (allows `unsafe-inline` for Tailwind compatibility)
- **`sanitizeText()`**: strips HTML tags before storing user content (XSS defense)
- **`escapeHtml()`**: used when injecting user content into DOM in JS
- **`sanitizeUser()`**: always strips `passcode_hash` before sending user data to clients
- **`sanitizeConnection()`**: adds derived `my_*` / `other_*` reveal fields; masks partner data
- **Dummy bcrypt compare**: prevents timing-based username enumeration during login
- **Uploads protection**: `app.use('/uploads', requireAuth)` — authenticated users only
- **Session table RLS**: Auto-applied at startup on Supabase `public.session` table

---

## 9. Content Moderation (Two-Tier Profanity Filter)

**Canonical list**: `config/profanity.json`. `utils/profanity.js` imports it on the server; `npm run generate:profanity` produces `public/js/profanity-words.generated.js` for the client pre-encryption check. The test suite rejects stale generated output.

**Server**: `utils/profanity.js` — `hasForbiddenText(text)` is called on every `POST /api/messages/send`.

**Client**: `public/js/shared.js` uses the generated list to block submission before it leaves the browser.

**Tier 1 — FORBIDDEN_WORDS**: Full abusive words matched as **substrings** (catches embedded variants like `$rishihood$`, `abhenchodcd`).

**Tier 2 — FORBIDDEN_SHORT_TOKENS**: Short ambiguous tokens (`bc`, `mc`, `sex`, `gand`, etc.) matched **only as standalone words** (word-boundary `\b`) to avoid blocking `mac`, `Sussex`, `Gandalf`.

**E2EE ciphertext is never scanned** server-side. The client blocks profanity before encryption.

The keyword `rishihood` is in TIER 1 — blocked as a substring in all messages.

---

## 10. Developer Rules (MUST FOLLOW)

1. **Never break ecosystem isolation** — discovery MUST filter by ecosystem. Discovery is gated in `userOps.getDiscoverable()`.
2. **Never skip connection ownership checks** — `getCachedConnection(connectionId, userId)` (or `connectionOps.getConnection()`) on every message route before acting.
3. **Never inject raw HTML** — always `sanitizeText()` on stored content, `escapeHtml()` on content rendered into DOM.
4. **SSE is the only real-time transport** — do not add a WebSocket fallback without replacing SSE deliberately.
5. **Firestore for relationships, Supabase for messages** — permanent architecture split. Never write chat messages to Firestore. Never write connections to Supabase.
6. **Reveal timeline is fixed** — Day 7 = Identity Reveal, Day 10 = Face Reveal (24h window), Day 11 = sweep expiry. Do NOT change timings without updating `connectionOps.respond()`, `sweepExpired()`, and all client countdown logic in `chat.js`.
7. **No server-rendered HTML** — pure MPA with static HTML + vanilla JS.
8. **Run `npx cap sync android`** before building APK after any web change.
9. **APK is gitignored** — 126MB, distribute manually from `builds/delulu.apk`.
10. **Profanity filter is generated** — edit `config/profanity.json`, run `npm run generate:profanity`, and commit the generated asset.
11. **Never bypass connection mutation helpers** — use `updateConnection()` or `updateConnections()` for every Firestore connection write; they handle eviction automatically.
12. **Read receipts live in Supabase** — not Firestore. Use `readReceiptOps.markRead()` and `readReceiptOps.getForConnection()`. Do NOT write to `from_last_read_at`/`to_last_read_at` in the Firestore connection doc.
13. **Never block the event loop on sweeps** — the 30-minute sweep uses paginated Firestore reads (batch size 500) with a single `batch.commit()` per page, not one write per document.
14. **`client_uuid` is the idempotency key for messages** — `messageOps.send()` uses it to prevent duplicate inserts on client retry. Always pass it from the UI if available.
15. **Username cooldown is 15 days** — enforced via `username_changed_at` field. Constant `USERNAME_COOLDOWN_MS = 15 * 24 * 60 * 60 * 1000` in `server.js`.

---

## 11. Performance & Resilience Architecture

1. **API Response Compression**: `compression` middleware (Gzip/Brotli) at 512-byte threshold. Bypasses SSE streams and pre-compressed media.
2. **Multi-Layer CircuitBreaker Fault Isolation**:
   - `brevoBreaker` (email): 5s timeout, trips on 3 failures, resets after 10s, max 5 concurrent
   - `pushBreaker` (Web Push): 4s timeout, trips on 5 failures, resets after 15s, max 10 concurrent
   - `fcmBreaker` (FCM): 5s timeout, trips on 3 failures, resets after 10s, max 20 concurrent
   - `supabaseBreaker` (in `db/supabase.js`): wraps Supabase client calls
3. **Multi-Row Batched Writes**: Firestore uses `BATCH_LIMIT = 400` in batch operations. Supabase uses `messageOps.bulkSend()` for chunked multi-row inserts.
4. **Optimistic UI & Rollback**: Local state updates instantly. Profile edits use `backupUser` snapshot + rollback on server error. Emoji reactions and message deletes are reflected client-side first.
5. **Discover Feed Cursor + Snapshot Model**: The full scored candidate list is built once per viewer/filter window (10 min), signed cursor pages into it without re-querying. "View More" costs zero Firebase reads within the cache window.
6. **Connection Auth Cache** (`connectionAuthCache` in `server.js`): 30-second short-circuit for `getConnection()` on hot message paths. Evicted instantly on status change.
7. **Last-message cache** (`_lastMessageCache`): 15-second Supabase read cache for chat list previews. Prevents per-connection last-message queries from flooding Supabase.
8. **`mapWithConcurrency(items, 6, mapper)`**: Used in `getActiveConnections()` to fetch partner profiles + last messages concurrently with cap of 6.
9. **Read Receipt Write Coalescing**: `readReceiptOps.markRead()` has a 10-second write guard — a second "mark read" within 10s of the last write is dropped.

---

## 12. Pages & Frontend JS Modules

| Page | JS Module | Key Features |
|------|----------|--------------|
| `login.html` | `login.js` | OTP flow, direct token verification, forgot password, animated heart background |
| `discover.html` | `discover.js` | Cursor-paginated feed, 3D avatar carousel, connect/dismiss, hobby match badges |
| `requests.html` | `requests.js` | Incoming/sent tabs, accept/reject, match-celebration confetti animation |
| `messages.html` | `messages.js` | Active chat list, per-user SSE stream, rich Telegram-style top toasts, unread badge in tab title "(3) Delulu" |
| `chat.html` | `chat.js` | Full chat room, SSE + game events, Day 7 identity reveal, Day 10 face reveal, "Not Vibing" button, icebreaker games, emoji reactions, message delete, E2EE, offline cache |
| `profile.html` | `profile.js` | Bio/hobbies/avatar edit, optimistic rollback |
| `settings.html` | `settings.js` | Username change (15-day cooldown UI), password reset with OTP flow |
