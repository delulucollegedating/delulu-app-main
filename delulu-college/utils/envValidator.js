/**
 * Environment Variable Validation Utility
 * Provides consistent validation and error handling for required environment variables
 */

/**
 * Validates that required environment variables are set
 * @param {Object} config - Configuration object
 * @param {string} config.varName - Environment variable name (or array of names for multiple vars)
 * @param {string} config.errorMessage - Error message to display
 * @param {string} [config.helpText] - Optional help text with instructions
 * @param {boolean} [config.productionOnly=false] - Only required in production
 * @param {boolean} [config.fatal=true] - Exit process on failure (false = warning only)
 * @throws {Error} Exits process if validation fails (when fatal=true)
 */
function requireEnv(config) {
  const {
    varName,
    errorMessage,
    helpText,
    productionOnly = false,
    fatal = true
  } = config;

  // Check if this validation only applies to production
  if (productionOnly && process.env.NODE_ENV !== 'production') {
    // In development, just warn if missing
    const vars = Array.isArray(varName) ? varName : [varName];
    const missing = vars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      console.warn(`WARNING: ${missing.join(', ')} not set. ${errorMessage}`);
    }
    return;
  }

  // Check if all required variables are set
  const vars = Array.isArray(varName) ? varName : [varName];
  const missing = vars.filter(v => !process.env[v]);

  if (missing.length === 0) {
    return; // All required vars are present
  }

  // Build error message
  const varList = missing.join(', ');
  console.error(`FATAL: ${varList} must be set in .env or environment.`);
  console.error(errorMessage);
  if (helpText) {
    console.error(helpText);
  }

  if (fatal) {
    process.exit(1);
  }
}

/**
 * Validates multiple environment variables at once
 * @param {Array<Object>} validations - Array of validation configs
 */
function validateEnvironment(validations) {
  validations.forEach(config => requireEnv(config));
}

module.exports = {
  requireEnv,
  validateEnvironment
};
