# Delulu — Claude Code Developer Guide

## Quick Reference
- **Stack**: Node 22 + Express 5, Firestore (Users/Connections), Supabase Postgres (Messages/Receipts), Capacitor 8 (Android/iOS), Vanilla JS + Tailwind CSS (MPA).
- **Architecture & Rules**: Read [../AGENTS.md](../AGENTS.md) or [.agents/AGENTS.md](.agents/AGENTS.md).
- **APK & Mobile Build**: Read [../APK_BUILD_GUIDE.md](../APK_BUILD_GUIDE.md).

## Key Commands
```bash
npm run dev                  # Start local dev server (port 3000)
npm test                     # Run Vitest test suites
npm run build:css            # Compile Tailwind CSS
npm run generate:profanity   # Regenerate client profanity check
npx cap sync android         # Sync web assets to Android
cd android && ./gradlew assembleRelease  # Build release APK
```

## Essential Coding Rules
1. **Ecosystem Isolation**: Discovery MUST ALWAYS filter by `ecosystem === user.ecosystem`.
2. **Database Split**:
   - **Firestore**: Users, connections, auth, devices, reports.
   - **Supabase**: Chat messages, read receipts, sessions.
3. **No Direct Firestore Client Calls**: All database access goes through `server.js` and `database.js` via Admin SDK.
4. **SSE Real-Time Only**: Use Server-Sent Events (`/api/connections/:id/stream`, `/api/user/stream`).
5. **Reveal Timelines**: Day 7 (Identity Reveal), Day 10 (Face Reveal), Day 11 (24h Expiry Sweep).
6. **Mobile Auth**: HMAC Bearer token stored in `@capacitor/preferences` (never web `localStorage`).
