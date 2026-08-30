import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      VITEST: 'true',
      NODE_ENV: 'development',
      // Force the in-memory session store: server.js selects the persistent
      // Postgres/Redis session store when these are set, and tests must never
      // write synthetic sessions to a real production session table.
      REDIS_URL: '',
      SUPABASE_DB_URL: '',
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-12345',
      SESSION_SECRET: 'test-session-secret-at-least-32-characters-long-for-vitest-suite-0123456789abcdef',
    },
  },
});
