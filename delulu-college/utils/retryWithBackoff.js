/**
 * Retry With Exponential Backoff
 *
 * Automatically retries failed operations with increasing delays between attempts.
 * Useful for transient failures (network blips, rate limits, temporary service unavailability).
 *
 * Usage:
 *   const result = await retryWithBackoff(() => fetchData(), { maxAttempts: 3 });
 */

class RetryableError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'RetryableError';
    this.originalError = originalError;
  }
}

class NonRetryableError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'NonRetryableError';
    this.originalError = originalError;
  }
}

/**
 * Retry function with exponential backoff
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry configuration
 * @param {number} options.maxAttempts - Maximum retry attempts (default: 3)
 * @param {number} options.baseDelayMs - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay in ms (default: 30000)
 * @param {number} options.backoffFactor - Multiplier for each retry (default: 2)
 * @param {Function} options.shouldRetry - Custom retry predicate (default: retry on any error)
 * @param {Function} options.onRetry - Callback before each retry attempt
 * @returns {Promise<any>} Result of successful execution
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    backoffFactor = 2,
    shouldRetry = defaultShouldRetry,
    onRetry = null
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is explicitly non-retryable
      if (error instanceof NonRetryableError) {
        throw error.originalError || error;
      }

      // Use custom retry predicate
      if (!shouldRetry(error, attempt)) {
        throw error;
      }

      // Last attempt - don't wait, just throw
      if (attempt >= maxAttempts) {
        break;
      }

      // Calculate exponential backoff with jitter
      const exponentialDelay = Math.min(
        baseDelayMs * Math.pow(backoffFactor, attempt - 1),
        maxDelayMs
      );
      const jitter = Math.random() * 0.3 * exponentialDelay; // ±30% jitter
      const delayMs = Math.floor(exponentialDelay + jitter);

      // Callback before retry
      if (onRetry) {
        onRetry(error, attempt, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // All attempts exhausted
  throw lastError;
}

/**
 * Default retry predicate - retries on network errors, timeouts, and 5xx errors
 */
function defaultShouldRetry(error, attempt) {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // Timeout errors
  if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
    return true;
  }

  // HTTP 5xx errors (server errors)
  if (error.status >= 500 && error.status < 600) {
    return true;
  }

  // HTTP 429 (rate limit) - retry with backoff
  if (error.status === 429) {
    return true;
  }

  // HTTP 408 (request timeout)
  if (error.status === 408) {
    return true;
  }

  // Supabase-specific errors
  if (error.code === '08000' || error.code === '08006') { // Connection errors
    return true;
  }

  // Firebase-specific errors
  if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
    return true;
  }

  // Default: don't retry
  return false;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry with specific error handling for database operations
 */
async function retryDatabaseOperation(fn, options = {}) {
  return retryWithBackoff(fn, {
    maxAttempts: options.maxAttempts || 3,
    baseDelayMs: options.baseDelayMs || 500,
    maxDelayMs: options.maxDelayMs || 5000,
    shouldRetry: (error, attempt) => {
      // Don't retry validation errors
      if (error.code === '23505') return false; // Unique constraint violation
      if (error.code === '23503') return false; // Foreign key violation
      if (error.code === '23502') return false; // Not null violation
      if (error.code === '22P02') return false; // Invalid text representation

      // Don't retry permission errors
      if (error.code === 'permission-denied') return false;
      if (error.code === 'PGRST301') return false; // Supabase RLS violation

      // Retry connection/timeout errors
      return defaultShouldRetry(error, attempt);
    },
    onRetry: options.onRetry || ((error, attempt, delayMs) => {
      console.warn(`Database operation failed (attempt ${attempt}), retrying in ${delayMs}ms:`, error.message);
    })
  });
}

/**
 * Retry with specific error handling for external API calls
 */
async function retryApiCall(fn, options = {}) {
  return retryWithBackoff(fn, {
    maxAttempts: options.maxAttempts || 3,
    baseDelayMs: options.baseDelayMs || 1000,
    maxDelayMs: options.maxDelayMs || 10000,
    shouldRetry: (error, attempt) => {
      // Don't retry 4xx client errors (except 429)
      if (error.status >= 400 && error.status < 500 && error.status !== 429 && error.status !== 408) {
        return false;
      }

      // Retry 5xx server errors and rate limits
      return defaultShouldRetry(error, attempt);
    },
    onRetry: options.onRetry || ((error, attempt, delayMs) => {
      console.warn(`API call failed (attempt ${attempt}), retrying in ${delayMs}ms:`, error.message);
    })
  });
}

/**
 * Timeout wrapper with automatic abort
 */
async function withTimeout(fn, timeoutMs = 5000, timeoutMessage = 'Operation timed out') {
  const controller = new AbortController();

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      controller.abort();
      const error = new Error(timeoutMessage);
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });

  try {
    const work = Promise.resolve(fn(controller.signal));
    // Prevent unhandled rejection if timeout wins
    work.catch(() => {});
    return await Promise.race([work, timeoutPromise]);
  } catch (error) {
    throw error;
  }
}

/**
 * Combined retry + timeout wrapper
 *
 * Usage:
 *   const result = await retryWithTimeout(
 *     (signal) => fetch(url, { signal }),
 *     { maxAttempts: 3, timeoutMs: 5000 }
 *   );
 */
async function retryWithTimeout(fn, options = {}) {
  const { timeoutMs = 5000, ...retryOptions } = options;

  return retryWithBackoff(
    () => withTimeout(fn, timeoutMs),
    retryOptions
  );
}

module.exports = {
  retryWithBackoff,
  retryDatabaseOperation,
  retryApiCall,
  withTimeout,
  retryWithTimeout,
  RetryableError,
  NonRetryableError
};
