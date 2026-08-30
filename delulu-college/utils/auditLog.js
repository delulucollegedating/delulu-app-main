/**
 * Audit Log System
 * Tracks sensitive security and moderation actions
 */

const { getDB } = require('../database');
const { createLogger } = require('./logger');

const auditLogger = createLogger({ component: 'audit' });

/**
 * Audit event types
 */
const AuditEventType = {
  // Authentication & Security
  LOGIN: 'user.login',
  LOGOUT: 'user.logout',
  PASSWORD_RESET: 'user.password_reset',
  TOTP_ENABLED: 'user.2fa_enabled',
  TOTP_DISABLED: 'user.2fa_disabled',
  TOKEN_REVOKED: 'user.token_revoked',

  // Moderation Actions
  USER_REPORTED: 'moderation.user_reported',
  USER_BLOCKED: 'moderation.user_blocked',
  USER_UNBLOCKED: 'moderation.user_unblocked',
  CONTENT_FLAGGED: 'moderation.content_flagged',

  // Connection Actions
  CONNECTION_ENDED: 'connection.ended',
  FACE_REVEAL_DECLINED: 'connection.face_reveal_declined',

  // Admin Actions
  ADMIN_ACCESS: 'admin.access',
  ADMIN_DATA_EXPORT: 'admin.data_export',
  ADMIN_USER_DELETE: 'admin.user_delete',

  // System Events
  RATE_LIMIT_EXCEEDED: 'system.rate_limit_exceeded',
  CIRCUIT_BREAKER_TRIPPED: 'system.circuit_breaker_tripped'
};

/**
 * Log an audit event to Firestore and structured logs
 * @param {Object} event - Audit event details
 * @param {string} event.type - Event type from AuditEventType
 * @param {number} event.userId - User who performed the action
 * @param {number} [event.targetUserId] - User who was affected (for moderation)
 * @param {Object} [event.metadata] - Additional context
 * @param {string} [event.ipAddress] - IP address of the actor
 * @param {string} [event.correlationId] - Request correlation ID
 */
async function logAuditEvent(event) {
  const {
    type,
    userId,
    targetUserId = null,
    metadata = {},
    ipAddress = null,
    correlationId = null
  } = event;

  const auditEntry = {
    type,
    userId,
    targetUserId,
    metadata,
    ipAddress,
    correlationId,
    timestamp: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  try {
    // Write to Firestore for long-term storage and querying
    const db = getDB();
    await db.collection('audit_logs').add(auditEntry);

    // Also write to structured logs for real-time monitoring
    auditLogger.audit(type, {
      userId,
      targetUserId,
      metadata,
      ipAddress,
      correlationId
    });

    return { success: true };
  } catch (error) {
    // If Firestore write fails, still log to console
    auditLogger.error('Failed to write audit log to Firestore', {
      error,
      auditEntry
    });

    // Don't throw - audit logging failure shouldn't break the main flow
    return { success: false, error: error.message };
  }
}

/**
 * Express middleware to automatically log authentication events
 */
function auditAuthMiddleware(eventType) {
  return (req, res, next) => {
    // Store original send function
    const originalSend = res.send;

    // Override send to capture response
    res.send = function(data) {
      // Only log successful auth actions
      if (res.statusCode === 200 || res.statusCode === 201) {
        logAuditEvent({
          type: eventType,
          userId: req.session?.userId || req.body?.userId,
          ipAddress: req.ip,
          correlationId: req.correlationId,
          metadata: {
            userAgent: req.headers['user-agent'],
            endpoint: req.path
          }
        }).catch(err => {
          // Silent fail - don't break the response
          console.error('Audit log failed:', err);
        });
      }

      // Call original send
      return originalSend.call(this, data);
    };

    next();
  };
}

/**
 * Query audit logs for a specific user
 * @param {number} userId - User ID to query
 * @param {Object} options - Query options
 * @param {number} [options.limit=50] - Max results
 * @param {Date} [options.startDate] - Filter from this date
 * @param {Date} [options.endDate] - Filter to this date
 * @param {string} [options.eventType] - Filter by event type
 */
async function queryAuditLogs(userId, options = {}) {
  const {
    limit = 50,
    startDate = null,
    endDate = null,
    eventType = null
  } = options;

  try {
    const db = getDB();
    let query = db.collection('audit_logs')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limit);

    if (startDate) {
      query = query.where('timestamp', '>=', startDate.toISOString());
    }

    if (endDate) {
      query = query.where('timestamp', '<=', endDate.toISOString());
    }

    if (eventType) {
      query = query.where('type', '==', eventType);
    }

    const snapshot = await query.get();
    const logs = [];

    snapshot.forEach(doc => {
      logs.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return logs;
  } catch (error) {
    auditLogger.error('Failed to query audit logs', { error, userId });
    throw error;
  }
}

module.exports = {
  AuditEventType,
  logAuditEvent,
  auditAuthMiddleware,
  queryAuditLogs
};
