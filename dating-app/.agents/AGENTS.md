# AGENTS.md — Delulu College Dating App

> **Purpose**: This file gives any AI agent (or developer) a complete mental model of the Delulu project — its architecture, data flows, algorithms, and rules — so no code needs to be read before making changes.

---

## 1. Project Overview

**Delulu** is an anonymous college dating app where identities are **hidden by design**. Users connect based on interests, chat anonymously over a **10-day Slow Dating timeline**, and reveal their face/identity to meet on **Day 10**. Think of it as "Blind Dating + Slow Dating" built for college students.

**Live URL**: https://delulu-college.onrender.com  
**Android APK**: `public/delulu.apk` (served locally — too large for GitHub)  
**Stack**: Node.js + Express (server), Firestore (users/connections), Supabase Postgres (messages), Capacitor (Android wrapper), Vanilla JS + Tailwind (frontend)

---

## 2. Tech Stack & Infrastructure

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Server | Express.js (Node 18+) | REST API + SSE + Socket.io |
| Compression | `compression` (Gzip / Brotli) | Response compression for JSON/text $\ge 1\text{KB}$ |
| Fault Resilience | `CircuitBreaker` (`utils/circuitBreaker.js`) | Protects Supabase DB, Brevo Email, and Push APIs |
| Primary DB | Firebase Firestore | Users, connections, games |
| Messages DB | Supabase Postgres | All chat messages (high write) |
| Sessions | connect-pg-simple → Supabase | Persistent 30-day sessions |
| Real-time | SSE (`/api/connections/:id/stream`) | Per-connection live events |
| Per-user RT | SSE (`/api/user/stream`) | Messages list live updates |
| Socket.io | Present but **MOCKED** on client | `socket.isMock = true` — do NOT rely on it |
| Auth | Express-session + bcrypt | Cookie-based, `httpOnly`, 30-day TTL |
| Push | Web Push (VAPID) | Browser push notifications |
| Native Push | `@capacitor/local-notifications` | Android native notifications |
| Email | Brevo API | OTP verification emails |
| Hosting | Render.com (free tier) | Auto-sleep when idle |
| Android | Capacitor (WebView wrapper) | APK from web codebase |

---

## 3. File Structure

```
dating-app/
├── server.js           # All API routes (1800+ lines)
├── database.js         # All Firestore + Supabase operations (2000+ lines)
├── db/supabase.js      # Supabase client (service-role, server-only) + supabaseBreaker
├── utils/circuitBreaker.js # CircuitBreaker fault isolation wrapper
├── firestore.rules     # Firestore security rules
├── capacitor.config.json
├── android/            # Capacitor Android project
└── public/
    ├── login.html       # Auth page (signup + OTP + login)
    ├── discover.html    # Profile swiping (3D card carousel + pagination)
    ├── requests.html    # Pending/sent connection requests
    ├── messages.html    # Active chats list
    ├── chat.html        # Individual chat room
    ├── profile.html     # Edit own profile
    ├── sw.js            # Service Worker (web push notifications)
    └── js/
        ├── shared.js    # Global utilities, auth, socket mock, navigation
        ├── login.js     # Signup/login/OTP flow
        ├── discover.js  # Discovery + pagination + connect/dismiss logic
        ├── requests.js  # Accept/reject request UI
        ├── messages.js  # Chat list + per-user SSE stream
        ├── chat.js      # Full chat room (messages, games, 10-day reveal, voice)
        ├── profile.js   # Profile edit with optimistic rollback
        ├── crypto.js    # E2EE (Web Crypto API — AES-GCM + ECDH)
        ├── chat-cache.js # IndexedDB message cache (Dexie.js)
        └── avatar3d.js  # Three.js 3D avatar carousel for discover page
```

---

## 4. Database Architecture

### 4.1 Firestore Collections

#### `users/{userId}`
```js
{
  id: Number,            // auto-incremented integer
  username: String,      // display name (anonymous, no real name)
  gender: "male"|"female",
  email: String,         // college email (determines ecosystem)
  passcode_hash: String, // bcrypt hash
  bio: String,
  hobbies: String[],     // ["hiking", "music", ...]
  avatar: String,        // avatar key e.g. "female_01"
  is_onboarded: 0|1,
  ecosystem: "rishihood"|"vitbhopal", // derived from email domain
  public_key: String|null,            // ECDH public key for E2EE
  encrypted_private_key: String|null, // E2EE private key encrypted with user password
  created_at: ISO8601
}
```

#### `connections/{connectionId}`
```js
{
  id: Number,
  from_user_id: Number,  // who sent the request
  to_user_id: Number,    // who received the request
  status: "pending"|"accepted"|"rejected"|"expired"|"revealed",
  created_at: ISO8601,
  chat_started_at: ISO8601|null,
  // 10-Day Face Reveal / Let's Meet
  face_reveal_available_at: ISO8601|null,
  from_face_reveal: 0|1,
  to_face_reveal: 0|1,
  face_reveal_declined_by: Number|null,
  meeting_code: String|null,   // Google Meet code when both agree
  // Read receipts
  from_last_read_at: ISO8601|null,
  to_last_read_at: ISO8601|null,
  // Icebreak game (stored inline)
  active_game: {
    game_type: "would_you_rather"|"truth_or_dare"|"hot_takes",
    question: String,
    answers: { [userId]: String },
    created_at: ISO8601
  }|null,
  last_message_at: ISO8601|null,
  ended_reason: String|null
}
```

#### `counters/{collectionName}`
Auto-incrementing integer ID generator. Used for `users` and `connections`.

#### `blocked_users/{docId}`
`{ from_user_id, to_user_id, created_at }`

#### `reported_users/{docId}`
`{ reporter_id, reported_user_id, reason, connection_id, created_at }`

#### `otp_codes/{docId}`
`{ email, code_hash, created_at, expires_at, verified: bool }`

### 4.2 Supabase Postgres Tables

#### `messages`
```sql
id              BIGSERIAL PRIMARY KEY
connection_id   INTEGER NOT NULL
sender_id       INTEGER NOT NULL
content         TEXT
reactions       JSONB DEFAULT '{}'     -- { "😂": [userId, ...] }
is_voice        INTEGER DEFAULT 0      -- 0=text, 1=voice, 2=photo
voice_duration  INTEGER DEFAULT 0      -- seconds
is_encrypted    INTEGER DEFAULT 0      -- 0=plain, 1=E2EE
iv              TEXT                   -- AES-GCM IV for E2EE
created_at      TIMESTAMPTZ DEFAULT NOW()
deleted_at      TIMESTAMPTZ            -- soft-delete tombstone
deleted_by      INTEGER
```

#### `push_subscriptions`
```sql
user_id        INTEGER
endpoint       TEXT
keys           JSONB    -- { p256dh, auth }
created_at     TIMESTAMPTZ
```

#### `session` (auto-created by connect-pg-simple)
```sql
sid     VARCHAR PRIMARY KEY
sess    JSON
expire  TIMESTAMPTZ
```

---

## 5. Core Algorithms & Workflows

### 5.1 Ecosystem Algorithm (CRITICAL — DO NOT CHANGE)
Users are siloed into **ecosystems** based on their college email domain. Users from different ecosystems **never see each other** in discover.

```js
function getEcosystem(email) {
  const domain = email.split('@')[1];
  if (domain === 'vitbhopal.ac.in') return 'vitbhopal';
  return 'rishihood'; // default for nst.rishihood.edu.in and all others
}
```

**Discovery query** always filters by `ecosystem === userEcosystem`. This is the core isolation mechanism.

### 5.2 Discovery Algorithm, Ecosystem Sharding & Pagination (UPDATED)
The discover page shows profiles filtered by:
1. **Same ecosystem** as the viewer (mandatory college isolation)
2. **Paginated Feed (15 profiles per page)**: `GET /api/discover?page=1&limit=15`. Slices the personalized candidate pool. The UI shows a floating **View More** button at the end of each batch to load additional profiles smoothly.
3. **Ecosystem Sharded In-Memory Candidates Cache**: Shared ecosystem candidates are cached in memory (`ecosystemCandidatesCache`, 5 min TTL) to eliminate database read load during high concurrent traffic.
4. **Dynamic Hole Hydration**: Viewer-specific exclusions (already connected users, blocked users, self) and case-insensitive hobby compatibility scores are computed dynamically per request without mutating the cached candidate pool.
5. **Deterministic Tie-Breaker**: Sorted by hobby compatibility score descending, then `String(a.id).localeCompare(String(b.id))` as a stable tie-breaker.
6. **Multi-Tiered Query Fallback**: If a composite Firestore query fails or an index is missing, discovery automatically falls back through 3 levels of in-memory filtering, guaranteeing **0 server crashes (HTTP 500)**.
7. **Reconnection Allowed**: Users with `rejected` or `ended` connection status ("Not Vibing") are **NOT** excluded, allowing former connections to rediscover each other once their previous chat has ended.

### 5.3 Connection Lifecycle (10-DAY SLOW DATING)
```
[Discover] → Send Request (status: "pending")
    ↓
[Requests page] → Accept → status: "accepted"
    - chat_started_at = NOW
    - face_reveal_available_at = NOW + 10 days
    ↓
[Chat] Day 1-9: Anonymous chat only
    - Status subtext displays: "Face reveal in Xd"
    ↓
[Chat] Day 10+: Face Reveal & Let's Meet button unlocks
    - Both users click "Let's Meet" to reveal face & identity
    - If both agree → meeting_code generated → Google Meet video room
    - status changes to "revealed"
```

**Either user can end the chat at any time** with "Not Vibing" button → status: "rejected", ended_reason: "not_vibing". Ending a chat instantly clears messages from Supabase Postgres, releases exclusive 1-to-1 active connection locks, and broadcasts `ended` (chat room) and `chat_ended` (messages list) SSE events to both users.

### 5.4 Connection Expiry Sweep (Background Job)
`connectionOps.sweepExpired()` runs on a schedule (every 24h):
- Connections where `face_reveal_available_at < NOW` AND NOT both agreed → status: "expired"

### 5.5 Icebreak Game Algorithm (CRITICAL — DO NOT CHANGE)
Three game types: `would_you_rather`, `this_or_that`, `question`.
Atomic transaction locks in `connectionOps.startGame` and client deduplication (`isStartingIcebreaker`) prevent simultaneous tap desynchronization between both users.

### 5.6 E2EE Algorithm
Using Web Crypto API (browser-native):
1. **Key Generation**: On registration, generate ECDH P-256 key pair
2. **Key Storage**: Public key → Firestore `users/{id}.public_key`; private key → AES-GCM encrypted with user password via PBKDF2 (100,000 iterations) → `users/{id}.encrypted_private_key`
3. **Shared Secret**: When chat opens, derive ECDH shared secret from own private key + partner's public key
4. **Encryption**: AES-GCM with random 128-bit IV; ciphertext in `content`, IV stored separately
5. **Flag**: `is_encrypted: 1` on encrypted messages

---

## 6. Real-Time Architecture

### IMPORTANT: Socket.io is Disabled
`socket.isMock = true` in `shared.js`. The socket object is a no-op stub. **Do not add real socket.io client code.**

### 6.1 Per-Connection SSE (`/api/connections/:id/stream`)
- Client opens `EventSource` when entering a chat room
- Server uses `connectionEmitter` (Node.js EventEmitter) to push events
- Event types: `message`, `read`, `typing`, `presence`, `game`, `info`, `ended`
- Heartbeat every 25s prevents Render proxy timeout

### 6.2 Per-User SSE (`/api/user/stream`)
- Client opens on messages list page
- Server uses `userEmitter` to push events
- Displays rich Telegram-style top toasts (`showRichToast`) and updates browser tab title with unread badge count (`(3) Delulu`)

---

## 7. Authentication & Session

- **Store**: Supabase Postgres (`connect-pg-simple`) — requires `SUPABASE_DB_URL` env var
- **Fallback**: `memorystore` (sessions lost on restart) if no `SUPABASE_DB_URL`
- **TTL**: 30 days, `rolling: true`
- **Cookie**: `httpOnly: true`, `sameSite: 'none'` + `secure: true` in production

---

## 8. Developer Rules (MUST FOLLOW)

1. **Never break ecosystem isolation** — discovery MUST filter by ecosystem
2. **Never skip connection ownership checks** — `getConnection(connectionId, userId)` on every message route
3. **Never inject raw HTML** — always `escapeHtml()` on user content
4. **Socket.io is mocked** — `socket.isMock = true`. Don't add real socket client code
5. **Firestore for relationships, Supabase for messages** — permanent architecture split
6. **Timeline is 10 days** — Day 1-9 = anonymous countdown, Day 10 = Face Reveal / Let's Meet
7. **No server-rendered HTML** — pure MPA with static HTML + vanilla JS
8. **Run `npx cap sync android`** before building APK after any web change
9. **APK is gitignored** — 126MB, distribute manually
10. **Strict Anonymity & Privacy** — No in-chat photo sharing or selfie photo verification. Identities remain 100% anonymous until mutual Day 10 consent.

---

## 9. Performance & Resilience Architecture

1. **API Response Compression**: Express middleware uses `compression` (Gzip/Brotli) for responses $\ge 1\text{KB}$, bypassing SSE streams and pre-compressed media.
2. **CircuitBreaker Fault Isolation**: `utils/circuitBreaker.js` protects external dependencies (`supabaseBreaker`, `brevoBreaker`, `pushBreaker`) with state transitions, concurrency caps, timeouts, and fallbacks.
3. **Multi-Row Batched Writes**: Supabase messages use chunked multi-row inserts (`messageOps.bulkSend`), and Firestore uses transaction chunking (`BATCH_LIMIT = 400`).
4. **Optimistic UI & Rollback**: Local state and UI update instantly on user actions (profile edits, swipes, invites, emoji reactions, message deletes), backed by `backupUser` snapshot capture and graceful rollback on server error.
5. **Ecosystem Candidate Fragment Caching**: Discover candidate pools are cached per ecosystem (`ecosystemCandidatesCache`, 5 min TTL) with dynamic viewer exclusion hydration.
