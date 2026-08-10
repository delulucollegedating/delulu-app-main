import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { findForbiddenText, hasForbiddenText, FORBIDDEN_WORDS, FORBIDDEN_SHORT_TOKENS } = require('../utils/profanity.js');
const canonicalWordList = require('../config/profanity.json');

describe('Chat profanity / forbidden content filter', () => {
  it('blocks the rishihood keyword standalone and case-insensitively', () => {
    expect(hasForbiddenText('rishihood')).toBe(true);
    expect(hasForbiddenText('I study at Rishihood')).toBe(true);
    expect(hasForbiddenText('RISHIHOOD rocks')).toBe(true);
  });

  it('blocks rishihood embedded in symbols or other letters', () => {
    expect(hasForbiddenText('$rishihood$')).toBe(true);
    expect(hasForbiddenText('jsafhjakdrishihoodsdwd')).toBe(true);
    expect(hasForbiddenText('xRishihoodY')).toBe(true);
  });

  it('blocks listed abusive words individually', () => {
    const samples = ['chutiya', 'bhosdika', 'bhenchod', 'bc', 'mc', 'bkl', 'gandu', 'gand', 'loda', 'sex', 'sexy', 'chod'];
    for (const word of samples) {
      expect(hasForbiddenText(word), `expected "${word}" to be blocked`).toBe(true);
    }
  });

  it('blocks full abusive words embedded inside other words or punctuation', () => {
    expect(hasForbiddenText('abhenchodcd')).toBe(true); // contains "bhenchod"
    expect(hasForbiddenText('he said gandu right now')).toBe(true);
    expect(hasForbiddenText('a!bhosdika!b')).toBe(true);
    expect(hasForbiddenText('she is so sexy tonight')).toBe(true); // "sexy" embedded
    expect(hasForbiddenText('$sexy$')).toBe(true);
  });

  it('allows innocent words that merely contain short combos like mc/bc/sex/gand', () => {
    const innocent = [
      'mac',          // m-a-c has no consecutive "mc"
      'abc',          // no standalone "bc"
      'abcde',
      'McDonalds',
      'McKinsey',
      'amc',
      'Sussex',       // "sex" inside a word — but NOT "sexy"
      'Gandalf',      // "gand" inside a word
      'gander',
      'sextant',      // "sext" ≠ "sexy"
      'back',         // no consecutive "bc"
      'block',
      'class'
    ];
    for (const msg of innocent) {
      expect(hasForbiddenText(msg), `expected "${msg}" to be allowed`).toBe(false);
    }
  });

  it('blocks short combos when used as standalone words (even with punctuation)', () => {
    const standalone = [
      'bc', 'mc', 'bkl', 'bsd', 'mkc', 'gand', 'gaand', 'sex', 'dick',
      'hey bc', '!mc!', '$sex$', 'gand.', 'bc?'
    ];
    for (const msg of standalone) {
      expect(hasForbiddenText(msg), `expected "${msg}" to be blocked`).toBe(true);
    }
  });

  it('returns the matched token via findForbiddenText', () => {
    expect(findForbiddenText('hello chutiya world')).toBe('chutiya');
    expect(findForbiddenText('jsafhjakdrishihoodsdwd')).toBe('rishihood');
    expect(findForbiddenText('just say bc')).toBe('bc');
    expect(findForbiddenText('all good here')).toBeNull();
    expect(findForbiddenText('')).toBeNull();
    expect(findForbiddenText(null)).toBeNull();
    expect(findForbiddenText(42)).toBeNull();
  });

  it('allows normal innocent messages', () => {
    const clean = [
      'hey how are you?',
      'hello world',
      'Let\'s meet for coffee tomorrow',
      'I love hiking and photography',
      'What is your favorite movie?',
      '1234567890',
      'I bought a new mac yesterday',
      'Check out this amazing place'
    ];
    for (const msg of clean) {
      expect(hasForbiddenText(msg), `expected "${msg}" to be allowed`).toBe(false);
    }
  });

  it('exposes non-empty word lists for auditability', () => {
    expect(Array.isArray(FORBIDDEN_WORDS)).toBe(true);
    expect(FORBIDDEN_WORDS.length).toBeGreaterThan(30);
    expect(Array.isArray(FORBIDDEN_SHORT_TOKENS)).toBe(true);
    expect(FORBIDDEN_SHORT_TOKENS.length).toBeGreaterThan(0);
  });

  it('keeps the generated browser list identical to the canonical list', () => {
    const clientAsset = fs.readFileSync(path.join(__dirname, '../public/js/profanity-words.generated.js'), 'utf8');
    const match = clientAsset.match(/Object\.freeze\((\{[\s\S]*\})\);\s*$/);
    expect(match, 'Run npm run generate:profanity after changing config/profanity.json.').not.toBeNull();
    expect(JSON.parse(match[1])).toEqual(canonicalWordList);
  });
});
