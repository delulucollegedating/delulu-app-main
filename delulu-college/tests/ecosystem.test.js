import { describe, it, expect } from 'vitest';
const { getEcosystem } = require('../database.js');

describe('College Ecosystem Domain Mapping', () => {
  it('maps vitbhopal.ac.in and vitbhopal.edu.in to vitbhopal ecosystem', () => {
    expect(getEcosystem('student@vitbhopal.ac.in')).toBe('vitbhopal');
    expect(getEcosystem('lakshit.24bce11263@vitbhopal.ac.in')).toBe('vitbhopal');
  });

  it('maps rishihood domain to rishihood ecosystem', () => {
    expect(getEcosystem('student@rishihood.edu.in')).toBe('rishihood');
  });

  it('returns null for unmapped or empty domains (security fix)', () => {
    // CRITICAL: Changed to return null instead of default to prevent ecosystem isolation bypass
    expect(getEcosystem('')).toBe(null);
    expect(getEcosystem(null)).toBe(null);
    expect(getEcosystem('user@gmail.com')).toBe(null);
    expect(getEcosystem('user@yahoo.com')).toBe(null);
  });
});
