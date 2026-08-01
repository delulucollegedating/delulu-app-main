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
// The client keeps its own copy of this logic in public/js/shared.js — keep the
// two lists AND the matching functions in sync when editing.

const FORBIDDEN_WORDS = [
  // Keyword explicitly requested for blocking
  'rishihood',

  // Hindi / Hinglish abuse (real words — safe to substring-match)
  'chutiya', 'chutiye', 'chutia', 'chutiyapanti',
  'bhosdika', 'bhosdike', 'bhosda', 'bhosdi', 'bhosad', 'bhosari', 'bhosri',
  'bhenchod', 'behenchod', 'behenchud', 'betichod',
  'madarchod', 'maderchod', 'madarchot',
  'gandu', 'gaandu',
  'loda', 'lode', 'lodu', 'lund', 'lawda', 'lawde', 'lauda', 'laude', 'laundiya',
  'chod', 'chodu', 'chudai', 'chudi', 'chuda',
  'bsdk',
  'suar', 'suwar', 'suala',
  'harami', 'haramkhor', 'haramzada',
  'kutta', 'kutte', 'kutiya', 'kutia', 'kutti',
  'randi', 'tatti', 'tharki',
  'bhadwa', 'bhadve', 'bhadwe',
  'chinal', 'chudail', 'kamina', 'kamini', 'nalayak', 'nalla',
  'jhaant', 'jhant', 'chakka', 'hijda', 'hijra',
  'fuddu', 'fudu',
  'bakchod', 'bakchodi',
  'ma ki', 'maa ki', 'behen ki', 'bhen ki',

  // English profanity
  'fuck', 'bitch', 'cunt', 'dickhead', 'shit', 'asshole', 'whore', 'slut',
  'pussy', 'bastard', 'motherfucker', 'nigger', 'porn', 'sexy'
];

// Short letter combos / ambiguous tokens. Matched ONLY as standalone words so
// innocent words like "mac", "abc", "McDonalds", "Sussex", "Gandalf" or the
// first name "Dick" are never blocked, while the standalone token still is.
const FORBIDDEN_SHORT_TOKENS = ['bc', 'mc', 'bkl', 'bsd', 'mkc', 'gand', 'gaand', 'sex', 'dick'];

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
