import { describe, it, expect, beforeEach } from 'vitest';
import CircuitBreaker from '../utils/circuitBreaker.js';

describe('CircuitBreaker Resilience & Fault Isolation Tests', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('TestService', {
      timeoutMs: 100,
      failureThreshold: 2,
      resetTimeoutMs: 300,
      maxConcurrent: 2
    });
  });

  it('should pass through successful calls in CLOSED state', async () => {
    const result = await breaker.execute(async () => 'success');
    expect(result).toBe('success');
    expect(breaker.getStatus().state).toBe('CLOSED');
  });

  it('should abort and count failure on timeout', async () => {
    const slowFn = async (signal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('slow'), 300);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Aborted'));
        });
      });
    };

    await expect(breaker.execute(slowFn)).rejects.toThrow('Aborted');
    expect(breaker.getStatus().consecutiveFailures).toBe(1);
  });

  it('should trip to OPEN state after reaching failure threshold and fast-fail', async () => {
    const failFn = async () => { throw new Error('Network error'); };

    // Failure 1
    await expect(breaker.execute(failFn)).rejects.toThrow('Network error');
    expect(breaker.getStatus().state).toBe('CLOSED');

    // Failure 2 -> Trips to OPEN
    await expect(breaker.execute(failFn)).rejects.toThrow('Network error');
    expect(breaker.getStatus().state).toBe('OPEN');

    // Fast-fail attempt without calling dependency
    let called = false;
    await expect(breaker.execute(async () => {
      called = true;
      return 'data';
    })).rejects.toThrow(/temporarily unavailable/i);

    expect(called).toBe(false); // Dependency was NOT called
  });

  it('should execute fallback function when circuit breaker is OPEN', async () => {
    const failFn = async () => { throw new Error('Failing'); };
    await expect(breaker.execute(failFn)).rejects.toThrow();
    await expect(breaker.execute(failFn)).rejects.toThrow();
    expect(breaker.getStatus().state).toBe('OPEN');

    const fallbackResult = await breaker.execute(
      async () => 'primary',
      (err) => `fallback-response: ${err.message}`
    );

    expect(fallbackResult).toMatch(/fallback-response/);
  });

  it('should enforce max concurrency limits to prevent connection exhaustion', async () => {
    let release;
    const pending = new Promise(r => release = r);

    const longCall = async () => {
      await pending;
      return 'done';
    };

    // Launch maxConcurrent (2) active calls
    const p1 = breaker.execute(longCall);
    const p2 = breaker.execute(longCall);

    // 3rd call should reject due to concurrency limit
    await expect(breaker.execute(longCall)).rejects.toThrow(/experiencing high load/i);

    release();
    await Promise.all([p1, p2]);
  });

  it('should transition HALF-OPEN and recover to CLOSED after successful probe', async () => {
    const failFn = async () => { throw new Error('Failing'); };
    await expect(breaker.execute(failFn)).rejects.toThrow();
    await expect(breaker.execute(failFn)).rejects.toThrow();
    expect(breaker.getStatus().state).toBe('OPEN');

    // Wait for resetTimeoutMs (300ms)
    await new Promise(r => setTimeout(r, 350));

    // Next call probes service in HALF-OPEN state
    const recoveryResult = await breaker.execute(async () => 'recovered');
    expect(recoveryResult).toBe('recovered');
    expect(breaker.getStatus().state).toBe('CLOSED');
  });
});
