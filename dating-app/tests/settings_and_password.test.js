import { describe, it, expect } from 'vitest';

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

  it('should validate username formatting correctly', () => {
    const validateUsername = (username) => {
      if (!username) return { valid: false, message: 'Username is required' };
      const str = String(username).trim();
      if (str.length < 3 || str.length > 20) return { valid: false, message: '3-20 characters' };
      if (!/^[a-zA-Z0-9_]+$/.test(str)) return { valid: false, message: 'Letters, numbers, underscores only' };
      return { valid: true };
    };

    expect(validateUsername('john_doe').valid).toBe(true);
    expect(validateUsername('usr123').valid).toBe(true);
    expect(validateUsername('ab').valid).toBe(false);
    expect(validateUsername('this_is_a_very_long_username_over_20_chars').valid).toBe(false);
    expect(validateUsername('john.doe').valid).toBe(false);
    expect(validateUsername('john<script>').valid).toBe(false);
    expect(validateUsername('  john_doe  ').valid).toBe(true);
  });

  it('should validate 6-digit OTP verification codes', () => {
    const validateOTP = (otp) => {
      if (!otp) return false;
      const str = String(otp).trim();
      return str.length === 6 && /^[0-9]{6}$/.test(str);
    };

    expect(validateOTP('123456')).toBe(true);
    expect(validateOTP('000000')).toBe(true);
    expect(validateOTP('12345')).toBe(false);
    expect(validateOTP('1234567')).toBe(false);
    expect(validateOTP('abc123')).toBe(false);
    expect(validateOTP(' 123456 ')).toBe(true);
  });
});
