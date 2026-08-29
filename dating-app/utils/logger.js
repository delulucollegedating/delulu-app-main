/**
 * Structured Logging Utility with Correlation IDs
 * Provides consistent logging format across the application
 */

const crypto = require('crypto');

/**
 * Generate a unique correlation ID for request tracing
 */
function generateCorrelationId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Structured logger class with correlation ID support
 */
class Logger {
  constructor(context = {}) {
    this.context = context;
    this.correlationId = context.correlationId || generateCorrelationId();
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext) {
    return new Logger({
      ...this.context,
      ...additionalContext,
      correlationId: this.correlationId
    });
  }

  /**
   * Format log entry with structured data
   */
  _format(level, message, meta = {}) {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: this.correlationId,
      ...this.context,
      ...meta,
      // Add process info for debugging
      pid: process.pid,
      hostname: require('os').hostname()
    };
  }

  /**
   * Log at different levels
   */
  debug(message, meta) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(JSON.stringify(this._format('debug', message, meta)));
    }
  }

  info(message, meta) {
    console.info(JSON.stringify(this._format('info', message, meta)));
  }

  warn(message, meta) {
    console.warn(JSON.stringify(this._format('warn', message, meta)));
  }

  error(message, meta) {
    const entry = this._format('error', message, meta);

    // Include stack trace if error object provided
    if (meta?.error instanceof Error) {
      entry.stack = meta.error.stack;
      entry.errorName = meta.error.name;
    }

    console.error(JSON.stringify(entry));
  }

  /**
   * Log with custom severity
   */
  log(level, message, meta) {
    const entry = this._format(level, message, meta);
    console.log(JSON.stringify(entry));
  }

  /**
   * Audit log for sensitive actions (reports, blocks, moderation)
   */
  audit(action, meta) {
    const entry = this._format('audit', action, {
      ...meta,
      auditType: 'security',
      timestamp: new Date().toISOString()
    });

    // Audit logs always written, regardless of log level
    console.log(JSON.stringify(entry));
  }
}

/**
 * Express middleware to attach correlation ID to requests
 */
function correlationMiddleware(req, res, next) {
  // Check for existing correlation ID from upstream (e.g., load balancer)
  const correlationId =
    req.headers['x-correlation-id'] ||
    req.headers['x-request-id'] ||
    generateCorrelationId();

  // Attach to request and response headers
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  // Create logger instance for this request
  req.logger = new Logger({
    correlationId,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.session?.userId || null
  });

  next();
}

/**
 * Create a logger instance with context
 */
function createLogger(context = {}) {
  return new Logger(context);
}

module.exports = {
  Logger,
  createLogger,
  correlationMiddleware,
  generateCorrelationId
};
