/**
 * Feature Flags System
 * Simple, environment-based feature toggling for gradual rollouts
 */

const { createLogger } = require('./logger');
const logger = createLogger({ component: 'feature-flags' });

// In-memory feature flag cache
const featureFlags = new Map();

/**
 * Feature flag definitions
 */
const FLAGS = {
  // Identity & Reveals
  IDENTITY_REVEAL_ENABLED: 'identity_reveal_enabled',
  FACE_REVEAL_ENABLED: 'face_reveal_enabled',

  // Icebreakers & Games
  ICEBREAKER_GAMES_ENABLED: 'icebreaker_games_enabled',
  WOULD_YOU_RATHER_ENABLED: 'would_you_rather_enabled',
  THIS_OR_THAT_ENABLED: 'this_or_that_enabled',

  // Communication
  VOICE_MESSAGES_ENABLED: 'voice_messages_enabled',
  E2E_ENCRYPTION_ENABLED: 'e2e_encryption_enabled',
  MESSAGE_REACTIONS_ENABLED: 'message_reactions_enabled',

  // Discovery
  HOBBY_MATCHING_ENABLED: 'hobby_matching_enabled',
  DISCOVERY_FEED_ENABLED: 'discovery_feed_enabled',

  // Push & Notifications
  PUSH_NOTIFICATIONS_ENABLED: 'push_notifications_enabled',
  EMAIL_NOTIFICATIONS_ENABLED: 'email_notifications_enabled',

  // Moderation & Safety
  PROFANITY_FILTER_ENABLED: 'profanity_filter_enabled',
  REPORT_SYSTEM_ENABLED: 'report_system_enabled',

  // Performance & Scaling
  REDIS_CACHE_ENABLED: 'redis_cache_enabled',
  FEED_CACHING_ENABLED: 'feed_caching_enabled',

  // Mobile
  APP_VERSION_ENFORCEMENT: 'app_version_enforcement',
  MIN_APP_VERSION: 'min_app_version'
};

/**
 * Initialize feature flags from environment variables
 * Format: FEATURE_FLAG_<FLAG_NAME>=true|false|value
 */
function initializeFeatureFlags() {
  // Default feature flags (all enabled by default)
  const defaults = {
    [FLAGS.IDENTITY_REVEAL_ENABLED]: true,
    [FLAGS.FACE_REVEAL_ENABLED]: true,
    [FLAGS.ICEBREAKER_GAMES_ENABLED]: true,
    [FLAGS.WOULD_YOU_RATHER_ENABLED]: true,
    [FLAGS.THIS_OR_THAT_ENABLED]: true,
    [FLAGS.VOICE_MESSAGES_ENABLED]: true,
    [FLAGS.E2E_ENCRYPTION_ENABLED]: true,
    [FLAGS.MESSAGE_REACTIONS_ENABLED]: true,
    [FLAGS.HOBBY_MATCHING_ENABLED]: true,
    [FLAGS.DISCOVERY_FEED_ENABLED]: true,
    [FLAGS.PUSH_NOTIFICATIONS_ENABLED]: true,
    [FLAGS.EMAIL_NOTIFICATIONS_ENABLED]: true,
    [FLAGS.PROFANITY_FILTER_ENABLED]: true,
    [FLAGS.REPORT_SYSTEM_ENABLED]: true,
    [FLAGS.REDIS_CACHE_ENABLED]: !!process.env.REDIS_URL,
    [FLAGS.FEED_CACHING_ENABLED]: true,
    [FLAGS.APP_VERSION_ENFORCEMENT]: false,
    [FLAGS.MIN_APP_VERSION]: '1.0.0'
  };

  // Load from environment variables
  for (const [flag, defaultValue] of Object.entries(defaults)) {
    const envKey = `FEATURE_FLAG_${flag.toUpperCase()}`;
    const envValue = process.env[envKey];

    let value = defaultValue;

    if (envValue !== undefined) {
      // Parse boolean values
      if (envValue === 'true') value = true;
      else if (envValue === 'false') value = false;
      else value = envValue; // Keep as string for version numbers, etc.
    }

    featureFlags.set(flag, value);
  }

  logger.info('Feature flags initialized', {
    count: featureFlags.size,
    flags: Object.fromEntries(featureFlags)
  });
}

/**
 * Check if a feature is enabled
 * @param {string} flag - Feature flag name from FLAGS
 * @returns {boolean}
 */
function isFeatureEnabled(flag) {
  if (!featureFlags.has(flag)) {
    logger.warn('Unknown feature flag queried', { flag });
    return false;
  }

  const value = featureFlags.get(flag);
  return value === true || value === 'true';
}

/**
 * Get feature flag value (for non-boolean flags like versions)
 * @param {string} flag - Feature flag name
 * @param {*} defaultValue - Default value if flag not set
 * @returns {*}
 */
function getFeatureValue(flag, defaultValue = null) {
  return featureFlags.get(flag) ?? defaultValue;
}

/**
 * Update a feature flag at runtime (for admin controls)
 * @param {string} flag - Feature flag name
 * @param {*} value - New value
 */
function setFeatureFlag(flag, value) {
  const oldValue = featureFlags.get(flag);
  featureFlags.set(flag, value);

  logger.info('Feature flag updated', {
    flag,
    oldValue,
    newValue: value
  });
}

/**
 * Get all feature flags (for admin dashboard)
 */
function getAllFeatureFlags() {
  return Object.fromEntries(featureFlags);
}

/**
 * Express middleware to check feature flag
 * Returns 503 if feature is disabled
 */
function requireFeature(flag, message = 'This feature is currently disabled') {
  return (req, res, next) => {
    if (!isFeatureEnabled(flag)) {
      return res.status(503).json({
        error: message,
        feature: flag,
        enabled: false
      });
    }
    next();
  };
}

/**
 * Check if user's app version meets minimum requirement
 */
function checkAppVersion(userVersion) {
  if (!isFeatureEnabled(FLAGS.APP_VERSION_ENFORCEMENT)) {
    return { allowed: true };
  }

  const minVersion = getFeatureValue(FLAGS.MIN_APP_VERSION, '1.0.0');

  try {
    const parseVersion = (v) => v.split('.').map(Number);
    const userParts = parseVersion(userVersion);
    const minParts = parseVersion(minVersion);

    for (let i = 0; i < 3; i++) {
      if (userParts[i] > minParts[i]) return { allowed: true };
      if (userParts[i] < minParts[i]) {
        return {
          allowed: false,
          message: `App version ${userVersion} is outdated. Please update to version ${minVersion} or higher.`,
          minVersion,
          userVersion
        };
      }
    }

    return { allowed: true };
  } catch (error) {
    logger.error('Error parsing app version', { error, userVersion, minVersion });
    // Allow access if version parsing fails
    return { allowed: true };
  }
}

// Initialize on module load
initializeFeatureFlags();

module.exports = {
  FLAGS,
  isFeatureEnabled,
  getFeatureValue,
  setFeatureFlag,
  getAllFeatureFlags,
  requireFeature,
  checkAppVersion,
  initializeFeatureFlags
};
