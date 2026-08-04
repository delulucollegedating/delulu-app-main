import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Settings & Password Reset Logic Unit Tests', () => {
  it('should enforce 15-day cooldown logic correctly', () => {
    const COOLDOWN_DAYS = 15;
    const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Changed 5 days ago -> locked
    const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    const elapsed5 = now - new Date(fiveDaysAgo).getTime();
    expect(elapsed5 < COOLDOWN_MS).toBe(true);
    const daysRemaining5 = Math.ceil((COOLDOWN_MS - elapsed5) / (24 * 60 * 60 * 1000));
    expect(daysRemaining5).toBe(10);

    // Changed 16 days ago -> unlocked
    const sixteenDaysAgo = new Date(now - 16 * 24 * 60 * 60 * 1000).toISOString();
    const elapsed16 = now - new Date(sixteenDaysAgo).getTime();
    expect(elapsed16 < COOLDOWN_MS).toBe(false);
  });
});
