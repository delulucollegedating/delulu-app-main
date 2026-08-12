import { describe, expect, it } from 'vitest';
import EmailQueue from '../utils/emailQueue.js';

describe('EmailQueue', () => {
  it('processes a signup burst without exceeding configured concurrency', async () => {
    const queue = new EmailQueue({ concurrency: 5, maxPending: 50, baseRetryMs: 1 });
    let active = 0;
    let peak = 0;

    const sends = Array.from({ length: 20 }, (_, index) => queue.enqueue(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return index;
    }));

    await expect(Promise.all(sends)).resolves.toEqual(Array.from({ length: 20 }, (_, index) => index));
    expect(peak).toBe(5);
    expect(queue.getStatus()).toMatchObject({ activeCount: 0, pendingCount: 0, concurrency: 5 });
  });

  it('retries temporary provider failures before succeeding', async () => {
    const queue = new EmailQueue({ concurrency: 1, maxAttempts: 3, baseRetryMs: 1 });
    let attempts = 0;

    const result = await queue.enqueue(async () => {
      attempts++;
      if (attempts < 3) {
        const error = new Error('Brevo API error: 429');
        error.status = 429;
        throw error;
      }
      return 'sent';
    });

    expect(result).toBe('sent');
    expect(attempts).toBe(3);
  });

  it('does not retry permanent provider errors', async () => {
    const queue = new EmailQueue({ concurrency: 1, maxAttempts: 3, baseRetryMs: 1 });
    let attempts = 0;

    await expect(queue.enqueue(async () => {
      attempts++;
      const error = new Error('Invalid sender');
      error.status = 400;
      throw error;
    })).rejects.toThrow('Invalid sender');

    expect(attempts).toBe(1);
  });
});
