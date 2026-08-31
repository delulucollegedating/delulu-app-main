/**
 * db/supabase.js
 * Server-side only Supabase client with CircuitBreaker fault isolation and retry logic.
 * Uses the SERVICE_ROLE_KEY — NEVER the anon key.
 * Never import this file in any client-side (public/) code.
 */
'use strict';

const { createClient } = require('@supabase/supabase-js');
const CircuitBreaker = require('../utils/circuitBreaker');
const { retryDatabaseOperation } = require('../utils/retryWithBackoff');

let _client = null;

const supabaseBreaker = new CircuitBreaker('SupabaseDB', {
  timeoutMs: 6000,       // Abort queries hanging over 6s
  failureThreshold: 5,   // Trip circuit after 5 consecutive database failures
  resetTimeoutMs: 10000, // Fast-fail for 10s before probing recovery
  maxConcurrent: 25      // Cap simultaneous database calls to prevent socket/thread exhaustion
});

function getSupabase() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables.'
    );
  }

  _client = createClient(url, key, {
    auth: {
      // Service role clients must not auto-refresh or persist sessions
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });

  return _client;
}

/**
 * Execute Supabase query with circuit breaker and retry logic
 *
 * @param {Function} queryFn - Function that executes the Supabase query
 * @param {Object} options - Retry options
 * @returns {Promise} Query result
 */
async function executeQuery(queryFn, options = {}) {
  return retryDatabaseOperation(
    () => supabaseBreaker.execute(queryFn),
    {
      maxAttempts: options.maxAttempts || 3,
      baseDelayMs: options.baseDelayMs || 500,
      maxDelayMs: options.maxDelayMs || 5000,
      onRetry: options.onRetry
    }
  );
}

module.exports = { getSupabase, supabaseBreaker, executeQuery };
