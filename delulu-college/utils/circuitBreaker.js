/**
 * CircuitBreaker — Protects the application from cascading failures and socket/thread exhaustion
 * when external dependencies (Brevo API, external services, DB calls) slow down or fail.
 */

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.timeoutMs = options.timeoutMs || 5000;          // Abort request after timeout (default 5s)
    this.failureThreshold = options.failureThreshold || 3; // Trip after N consecutive failures
    this.resetTimeoutMs = options.resetTimeoutMs || 10000;// Stay OPEN for 10s before testing recovery
    this.maxConcurrent = options.maxConcurrent || 10;      // Cap active concurrent calls to dependency

    this.state = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF-OPEN'
    this.consecutiveFailures = 0;
    this.lastStateChange = Date.now();
    this.activeCount = 0;
  }

  async execute(fn, fallbackFn = null) {
    const now = Date.now();

    // Check if OPEN state has expired → transition to HALF-OPEN to probe service
    if (this.state === 'OPEN') {
      if (now - this.lastStateChange >= this.resetTimeoutMs) {
        this.state = 'HALF-OPEN';
        this.lastStateChange = now;
      } else {
        // Fast-fail without hitting failing external service
        if (fallbackFn) {
          return fallbackFn(new Error(`CircuitBreaker[${this.name}] is OPEN (fast-failing)`));
        }
        throw new Error(`Service [${this.name}] is temporarily unavailable. Please try again in a few seconds.`);
      }
    }

    // Enforce max concurrency limit to avoid thread/socket exhaustion
    if (this.activeCount >= this.maxConcurrent) {
      if (fallbackFn) {
        return fallbackFn(new Error(`CircuitBreaker[${this.name}] max concurrency reached`));
      }
      throw new Error(`Service [${this.name}] is currently experiencing high load. Please retry.`);
    }

    this.activeCount++;
    const controller = new AbortController();

    // Hard timeout: Promise.race rejects even when the wrapped work ignores the
    // AbortController signal (e.g. supabase-js queries). Without this, one hung
    // DB call held its concurrency slot forever until maxConcurrent exhausted.
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        const err = new Error(`Aborted: CircuitBreaker[${this.name}] timed out after ${this.timeoutMs}ms`);
        err.name = 'TimeoutError';
        reject(err);
      }, this.timeoutMs);
    });

    try {
      const work = Promise.resolve(fn(controller.signal));
      // If the timeout wins the race and the slow work later rejects, that late
      // rejection must never surface as an unhandledRejection.
      work.catch(() => {});
      const result = await Promise.race([work, timeoutPromise]);
      clearTimeout(timeoutId);
      this.onSuccess();
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      this.onFailure(err);
      if (fallbackFn) {
        return fallbackFn(err);
      }
      throw err;
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }

  onSuccess() {
    this.consecutiveFailures = 0;
    if (this.state === 'HALF-OPEN') {
      this.state = 'CLOSED';
      this.lastStateChange = Date.now();
    }
  }

  onFailure() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold || this.state === 'HALF-OPEN') {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
    }
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      activeCount: this.activeCount,
      lastStateChange: this.lastStateChange
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.activeCount = 0;
    this.lastStateChange = Date.now();
  }
}

module.exports = CircuitBreaker;
