/**
 * Health Check Utility
 * Validates connectivity to all critical dependencies
 */

const { getDB } = require('../database');
const { getSupabase } = require('../db/supabase');
const { redisClient } = require('../services/redisClient');

/**
 * Check Firebase/Firestore connectivity
 */
async function checkFirestore(firebaseInitialized) {
  if (!firebaseInitialized) {
    return { status: 'warn', message: 'Firebase not initialized (dev mode)' };
  }

  try {
    const db = getDB();
    // Attempt to read a counter document (lightweight check)
    await db.collection('counters').doc('users').get();
    return { status: 'ok', message: 'Connected' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

/**
 * Check Supabase Postgres connectivity
 */
async function checkSupabase(client = null) {
  try {
    const supabase = client || getSupabase();
    const { data, error } = await supabase
      .from('messages')
      .select('id')
      .limit(1);

    if (error) throw error;
    return { status: 'ok', message: 'Connected' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

/**
 * Check Redis connectivity
 */
async function checkRedis() {
  if (!redisClient) {
    return { status: 'warn', message: 'Redis not configured' };
  }

  try {
    const status = redisClient.status;
    if (status === 'ready') {
      // Ping Redis to verify connection
      await redisClient.ping();
      return { status: 'ok', message: 'Connected' };
    } else {
      return { status: 'warn', message: `Status: ${status}` };
    }
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

/**
 * Check circuit breaker states
 */
function checkCircuitBreakers(breakers) {
  const states = {};
  for (const [name, breaker] of Object.entries(breakers)) {
    const status = breaker.getStatus(); // Fixed: getStatus() not getState()
    states[name] = {
      state: status.state, // 'CLOSED', 'OPEN', 'HALF_OPEN'
      failures: status.consecutiveFailures,
      activeCount: status.activeCount,
      lastStateChange: status.lastStateChange
    };
  }
  return states;
}

/**
 * Comprehensive health check
 * Returns detailed status of all dependencies
 */
async function performHealthCheck(options = {}) {
  const {
    firebaseInitialized = false,
    breakers = {}
  } = options;

  const startTime = Date.now();
  const checks = {
    firestore: await checkFirestore(firebaseInitialized),
    supabase: await checkSupabase(),
    redis: await checkRedis()
  };

  const circuitBreakers = checkCircuitBreakers(breakers);
  const responseTime = Date.now() - startTime;

  // Determine overall health status
  const hasError = Object.values(checks).some(c => c.status === 'error');
  const hasWarning = Object.values(checks).some(c => c.status === 'warn');

  let overallStatus = 'healthy';
  if (hasError) {
    overallStatus = 'unhealthy';
  } else if (hasWarning) {
    overallStatus = 'degraded';
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    responseTime,
    dependencies: checks,
    circuitBreakers,
    version: process.env.APP_VERSION || 'unknown'
  };
}

/**
 * Liveness probe - checks if the server process is alive
 * Should return 200 even if dependencies are down
 */
function livenessProbe() {
  return {
    status: 'alive',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pid: process.pid
  };
}

/**
 * Readiness probe - checks if the server can handle requests
 * Should return 503 if critical dependencies are down
 */
async function readinessProbe(options) {
  const health = await performHealthCheck(options);
  return {
    ready: health.status !== 'unhealthy',
    ...health
  };
}

module.exports = {
  performHealthCheck,
  livenessProbe,
  readinessProbe,
  checkFirestore,
  checkSupabase,
  checkRedis
};
