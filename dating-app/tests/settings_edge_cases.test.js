import { describe, it, expect } from 'vitest';

// Pure logic tests mirroring the exact rules enforced by server.js routes:
//  - /api/settings/check-username
//  - /api/settings/update-username (15-day cooldown)
//  - /api/settings/password-reset/verify-and-update (password rules)

const COOLDOWN_DAYS = 15;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// Username validation shared by check-username & update-username
function validateUsername(str) {
  const usernameStr = String(str).trim();
  if (usernameStr.length < 3 || usernameStr.length > 20) {
    return { valid: false, message: 'Must be between 3 and 20 characters' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(usernameStr)) {
    return { valid: false, message: 'Letters, numbers, and underscores only' };
  }
  return { valid: true, username: usernameStr };
}

// Cooldown math shared by user-info & update-username
function cooldownStatus(usernameChangedAt) {
  if (!usernameChangedAt) return { canChange: true, daysRemaining: 0 };
  const lastChanged = new Date(usernameChangedAt).getTime();
  const elapsed = Date.now() - lastChanged;
  if (elapsed < COOLDOWN_MS) {
    const daysRemaining = Math.ceil((COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
    return { canChange: false, daysRemaining };
  }
  return { canChange: true, daysRemaining: 0 };
}

// Password rule shared by both reset routes
function validateNewPassword(pwd) {
  if (!pwd || typeof pwd !== 'string') return { valid: false };
  if (pwd.length < 6) return { valid: false };
  return { valid: true };
}

// E2EE payload merging logic (mirrors reencryptE2EEKeysForNewPassword usage)
function buildResetPayload(e2eePayload) {
  return {
    ...(e2eePayload && e2eePayload.encrypted_private_key ? { encrypted_private_key: e2eePayload.encrypted_private_key } : {}),
    ...(e2eePayload && e2eePayload.public_key ? { public_key: e2eePayload.public_key } : {})
  };
}

describe('Settings Edge Cases', () => {
  describe('Username validation', () => {
    it('rejects empty, too-short, and too-long usernames', () => {
      expect(validateUsername('').valid).toBe(false);
      expect(validateUsername('  ').valid).toBe(false);
      expect(validateUsername('ab').valid).toBe(false);
      expect(validateUsername('a'.repeat(21)).valid).toBe(false);
    });

    it('accepts valid usernames and trims whitespace', () => {
      expect(validateUsername('alex_99').valid).toBe(true);
      expect(validateUsername('  cool_dude  ').username).toBe('cool_dude');
      expect(validateUsername('a'.repeat(20)).valid).toBe(true);
    });

    it('rejects special characters and spaces', () => {
      expect(validateUsername('has space').valid).toBe(false);
      expect(validateUsername('has-dash').valid).toBe(false);
      expect(validateUsername('has.dot').valid).toBe(false);
      expect(validateUsername('emoji😀').valid).toBe(false);
      expect(validateUsername('quote\'s').valid).toBe(false);
    });
  });

  describe('15-day cooldown', () => {
    it('allows change when never changed before', () => {
      expect(cooldownStatus(null).canChange).toBe(true);
    });

    it('locks immediately after a change (0 days elapsed)', () => {
      const status = cooldownStatus(new Date().toISOString());
      expect(status.canChange).toBe(false);
      expect(status.daysRemaining).toBe(15);
    });

    it('locks with 10 days remaining after 5 days', () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const status = cooldownStatus(fiveDaysAgo);
      expect(status.canChange).toBe(false);
      expect(status.daysRemaining).toBe(10);
    });

    it('unlocks exactly at 15 days', () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const status = cooldownStatus(fifteenDaysAgo);
      expect(status.canChange).toBe(true);
    });

    it('unlocks after more than 15 days', () => {
      const sixteenDaysAgo = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString();
      expect(cooldownStatus(sixteenDaysAgo).canChange).toBe(true);
    });

    it('handles exactly 1 day remaining without rounding to 0', () => {
      // 14 days + 12 hours elapsed → 12 hours remain → ceil to 1 day
      const elapsed = 14 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;
      const changedAt = new Date(Date.now() - elapsed).toISOString();
      const status = cooldownStatus(changedAt);
      expect(status.canChange).toBe(false);
      expect(status.daysRemaining).toBe(1);
    });
  });

  describe('Password rules', () => {
    it('rejects short and missing passwords', () => {
      expect(validateNewPassword('').valid).toBe(false);
      expect(validateNewPassword('12345').valid).toBe(false);
      expect(validateNewPassword(null).valid).toBe(false);
      expect(validateNewPassword(123456).valid).toBe(false); // non-string
    });

    it('accepts passwords of length 6+', () => {
      expect(validateNewPassword('123456').valid).toBe(true);
      expect(validateNewPassword('a'.repeat(20)).valid).toBe(true);
    });
  });

  describe('E2EE payload merge on password reset', () => {
    it('includes encrypted_private_key and public_key only when provided', () => {
      expect(buildResetPayload(null)).toEqual({});
      expect(buildResetPayload({})).toEqual({});
      expect(buildResetPayload({ encrypted_private_key: 'cipher' }))
        .toEqual({ encrypted_private_key: 'cipher' });
      expect(buildResetPayload({ encrypted_private_key: 'cipher', public_key: { kty: 'EC' } }))
        .toEqual({ encrypted_private_key: 'cipher', public_key: { kty: 'EC' } });
    });

    it('never sends stale/empty key material', () => {
      const payload = buildResetPayload({ encrypted_private_key: '', public_key: null });
      expect(payload.encrypted_private_key).toBeUndefined();
      expect(payload.public_key).toBeUndefined();
    });
  });
});
