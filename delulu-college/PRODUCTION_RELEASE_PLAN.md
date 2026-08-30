# Production Release Plan

This is the release gate for Delulu. A public release is approved only when every
item in this document is complete and recorded with evidence.

## Phase 1 — Production Infrastructure

- [ ] Add Railway Redis and set `REDIS_URL`; `/health/detailed` must report
  `healthy` with Firestore, Supabase, and Redis all `ok`.
- [ ] Set `SENTRY_DSN`; load the production site and confirm the server injects
  `window.__SENTRY_DSN__` without exposing credentials in logs.
- [ ] Confirm Railway has `SESSION_SECRET`, Firebase Admin credentials,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, Brevo, and
  stable VAPID keys.
- [ ] Set `APP_VERSION` to the release version so health responses identify the
  deployed build.

## Phase 2 — Signed Release Supply Chain

- [ ] Generate one private release keystore, store an offline encrypted backup,
  and record its SHA-256 certificate fingerprint in the release runbook.
- [ ] Add `RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`,
  `RELEASE_KEY_ALIAS`, and `RELEASE_KEY_PASSWORD` as protected GitHub Actions
  production secrets.
- [ ] Run **Signed Android Release** manually from GitHub Actions.
- [ ] Verify the resulting APK with `apksigner verify --print-certs`; the
  signer must not be `CN=Android Debug`.
- [ ] Publish exactly that verified APK to Railway and retain its SHA-256 hash.

## Phase 3 — Functional Acceptance on Real Devices

Use two college test accounts and at least two Android devices. Record device,
Android version, build SHA-256, and outcome for each test.

- [ ] Signup, email verification, login, logout, password reset, and 2FA.
- [ ] Same-ecosystem discovery and cross-ecosystem isolation.
- [ ] Request, accept, send/read/react/delete messages, report/block, and end
  chat.
- [ ] Push notification while foregrounded, backgrounded, swiped closed, and
  device locked. Force-stop is excluded: Android intentionally suppresses all
  pushes until the user opens the app again.
- [ ] Identity and face reveal timing, decline, and expiry handling.
- [ ] Data export and account deletion.
- [ ] Install an update over the prior release without uninstalling.

## Phase 4 — Operational Acceptance

- [ ] `npm test`, `npm run typecheck`, and `npm audit --omit=dev --audit-level=high` pass.
- [ ] CI is green for the exact release commit.
- [ ] Railway `/health/ready` and `/health/detailed` return HTTP 200 and
  `healthy` for 24 hours after deployment.
- [ ] Sentry receives a controlled non-sensitive test event.
- [ ] Document rollback: redeploy the previous signed APK and server release,
  with the same signing key.

## Release Decision

Approve public distribution only when all checks are complete. Until then, use
an invite-only beta with monitored users and a clear support escalation path.
