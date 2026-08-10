// ===== Chat Content Moderation Filter =====
// Blocks chat messages that contain abusive words or the "rishihood" keyword.
//
// Two-tier matching (both CASE-INSENSITIVE):
//   TIER 1 — FORBIDDEN_WORDS: full abusive words matched as SUBSTRINGS, so a
//     banned token is caught even when embedded inside other letters/symbols:
//       "$rishihood$", "jsafhjakdrishihoodsdwd", "abhenchodcd" -> blocked
//   TIER 2 — FORBIDDEN_SHORT_TOKENS: short letter combos (bc/mc/sex/gand/...)
//     matched ONLY as standalone words (word boundaries). This prevents false
//     positives inside innocent words:
//       "mac" (no consecutive "mc"), "abc", "McDonalds", "Sussex", "Gandalf"
//       -> ALLOWED
//       "bc", "!mc!", "hey sex", "gand" -> BLOCKED (standalone words)
//
// One canonical list serves both the Node validator and browser pre-encryption
// validator. `npm run generate:profanity` produces the browser asset and the
// test suite rejects stale generated output.
const { forbiddenWords: FORBIDDEN_WORDS, forbiddenShortTokens: FORBIDDEN_SHORT_TOKENS } = require('../config/profanity.json');

// Pre-compiled word-boundary patterns (built once at load — no per-message overhead)
const SHORT_TOKEN_PATTERNS = FORBIDDEN_SHORT_TOKENS.map(token => new RegExp(`\\b${token}\\b`));

const FORBIDDEN_MESSAGE_ERROR = 'This message contains words that are not allowed. Please rephrase.';

/**
 * Returns the first forbidden token found inside `text`, or null if the text is clean.
 * Non-string / empty input is always treated as clean.
 * @param {string} text
 * @returns {string|null}
 */
function findForbiddenText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lower = text.toLowerCase();
  // Tier 1: full abusive words — substring match (catches embedded variants)
  for (const word of FORBIDDEN_WORDS) {
    if (lower.includes(word)) return word;
  }
  // Tier 2: short letter combos — standalone word only (word-boundary match)
  for (let i = 0; i < SHORT_TOKEN_PATTERNS.length; i++) {
    if (SHORT_TOKEN_PATTERNS[i].test(lower)) return FORBIDDEN_SHORT_TOKENS[i];
  }
  return null;
}

/**
 * Returns true when `text` contains any forbidden token.
 * @param {string} text
 * @returns {boolean}
 */
function hasForbiddenText(text) {
  return findForbiddenText(text) !== null;
}

module.exports = { FORBIDDEN_WORDS, FORBIDDEN_SHORT_TOKENS, FORBIDDEN_MESSAGE_ERROR, findForbiddenText, hasForbiddenText };
