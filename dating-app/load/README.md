# 200-user chat load test

Run this only against a staging deployment with isolated test accounts and test
connections. It opens 200 authenticated SSE streams, waits until all are open,
then sends one simultaneous API action per user.

1. Copy `200-users.example.json` to `users.local.json`.
2. Create 200 staging users arranged in 100 accepted connections, then replace
   every placeholder token and connection ID. Do not use production accounts.
3. Run:

   ```sh
   TARGET_URL=https://your-staging-service.onrender.com \
   node load/200-user-chat-burst.mjs --config=load/users.local.json
   ```

Set `EXPECTED_USERS=2` when checking the sample file. To exercise an icebreaker
burst, set each user's `action` to `start-game`, run it, then change actions to
`answer-game` and run again.

Pass criteria: no HTTP 429/5xx responses, no lost/duplicate messages, and p95
send latency below your chosen target (a practical starting target is 1.5s).
