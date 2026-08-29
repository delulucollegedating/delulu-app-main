/**
 * GDPR Data Export & Compliance Utilities
 * Handles user data export, deletion, and right-to-access requests
 */

const { getDB } = require('../database');
const { supabase } = require('../db/supabase');
const { createLogger } = require('./logger');
const { logAuditEvent, AuditEventType } = require('./auditLog');

const logger = createLogger({ component: 'gdpr' });

/**
 * Export all user data in machine-readable format (GDPR Article 20)
 * @param {number} userId - User ID to export
 * @returns {Object} Complete user data package
 */
async function exportUserData(userId) {
  logger.info('Starting GDPR data export', { userId });

  try {
    const db = getDB();
    const exportData = {
      exportDate: new Date().toISOString(),
      userId,
      dataCategories: {}
    };

    // 1. User Profile Data
    const userDoc = await db.collection('users').doc(String(userId)).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      // Remove sensitive fields that shouldn't be exported
      delete userData.passcode_hash;
      delete userData.totp_secret;
      delete userData.totp_backup_codes;

      exportData.dataCategories.profile = userData;
    }

    // 2. Device Information
    const devicesSnapshot = await db.collection('users')
      .doc(String(userId))
      .collection('devices')
      .get();

    exportData.dataCategories.devices = [];
    devicesSnapshot.forEach(doc => {
      const device = doc.data();
      // Remove tokens for security
      delete device.fcm_token;
      delete device.web_push_subscription;
      exportData.dataCategories.devices.push(device);
    });

    // 3. Connections (from and to)
    const connectionsFrom = await db.collection('connections')
      .where('from_user_id', '==', userId)
      .get();

    const connectionsTo = await db.collection('connections')
      .where('to_user_id', '==', userId)
      .get();

    exportData.dataCategories.connections = [];
    [...connectionsFrom.docs, ...connectionsTo.docs].forEach(doc => {
      exportData.dataCategories.connections.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // 4. Messages (from Supabase)
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('sender_id', userId)
      .order('created_at', { ascending: false });

    if (messagesError) {
      logger.error('Error fetching messages for export', { error: messagesError, userId });
      exportData.dataCategories.messages = { error: messagesError.message };
    } else {
      exportData.dataCategories.messages = messages;
    }

    // 5. Read Receipts
    const { data: receipts, error: receiptsError } = await supabase
      .from('chat_read_receipts')
      .select('*')
      .eq('user_id', userId);

    if (receiptsError) {
      logger.error('Error fetching receipts for export', { error: receiptsError, userId });
      exportData.dataCategories.readReceipts = { error: receiptsError.message };
    } else {
      exportData.dataCategories.readReceipts = receipts;
    }

    // 6. Blocks (both directions)
    const blocksFrom = await db.collection('blocked_users')
      .where('from_user_id', '==', userId)
      .get();

    const blocksTo = await db.collection('blocked_users')
      .where('to_user_id', '==', userId)
      .get();

    exportData.dataCategories.blocks = [];
    [...blocksFrom.docs, ...blocksTo.docs].forEach(doc => {
      exportData.dataCategories.blocks.push(doc.data());
    });

    // 7. Reports Filed
    const reportsSnapshot = await db.collection('reported_users')
      .where('reporter_id', '==', userId)
      .get();

    exportData.dataCategories.reportsFiled = [];
    reportsSnapshot.forEach(doc => {
      exportData.dataCategories.reportsFiled.push(doc.data());
    });

    // 8. Audit Logs (if available)
    const auditLogsSnapshot = await db.collection('audit_logs')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    exportData.dataCategories.auditLogs = [];
    auditLogsSnapshot.forEach(doc => {
      exportData.dataCategories.auditLogs.push(doc.data());
    });

    // Log the export for compliance
    await logAuditEvent({
      type: AuditEventType.ADMIN_DATA_EXPORT,
      userId,
      metadata: {
        categories: Object.keys(exportData.dataCategories),
        recordCount: {
          devices: exportData.dataCategories.devices.length,
          connections: exportData.dataCategories.connections.length,
          messages: Array.isArray(exportData.dataCategories.messages) ? exportData.dataCategories.messages.length : 0,
          blocks: exportData.dataCategories.blocks.length
        }
      }
    });

    logger.info('GDPR data export completed', {
      userId,
      categories: Object.keys(exportData.dataCategories)
    });

    return {
      success: true,
      data: exportData
    };

  } catch (error) {
    logger.error('GDPR data export failed', { error: error.message, userId });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Delete all user data (GDPR Article 17 - Right to Erasure)
 * @param {number} userId - User ID to delete
 * @param {Object} options - Deletion options
 * @returns {Object} Deletion result
 */
async function deleteUserData(userId, options = {}) {
  const {
    keepAuditLogs = true, // Keep audit logs for compliance
    keepReports = true,   // Keep reports for safety/legal reasons
    adminUserId = null    // Admin who requested deletion
  } = options;

  logger.info('Starting GDPR data deletion', { userId, options });

  const deletionResults = {};

  try {
    const db = getDB();

    // 1. Delete user profile
    await db.collection('users').doc(String(userId)).delete();
    deletionResults.profile = 'deleted';

    // 2. Delete devices
    const devicesSnapshot = await db.collection('users')
      .doc(String(userId))
      .collection('devices')
      .get();

    const deviceDeletions = [];
    devicesSnapshot.forEach(doc => {
      deviceDeletions.push(doc.ref.delete());
    });
    await Promise.all(deviceDeletions);
    deletionResults.devices = `${deviceDeletions.length} deleted`;

    // 3. Delete connections (both directions)
    const connectionsFrom = await db.collection('connections')
      .where('from_user_id', '==', userId)
      .get();

    const connectionsTo = await db.collection('connections')
      .where('to_user_id', '==', userId)
      .get();

    const connectionDeletions = [];
    [...connectionsFrom.docs, ...connectionsTo.docs].forEach(doc => {
      connectionDeletions.push(doc.ref.delete());
    });
    await Promise.all(connectionDeletions);
    deletionResults.connections = `${connectionDeletions.length} deleted`;

    // 4. Soft-delete messages (mark as deleted, keep for reports if needed)
    const { error: messagesError } = await supabase
      .from('messages')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
        content: '[deleted]'
      })
      .eq('sender_id', userId)
      .is('deleted_at', null);

    if (messagesError) {
      logger.error('Error deleting messages', { error: messagesError, userId });
      deletionResults.messages = `error: ${messagesError.message}`;
    } else {
      deletionResults.messages = 'soft-deleted';
    }

    // 5. Delete read receipts
    const { error: receiptsError } = await supabase
      .from('chat_read_receipts')
      .delete()
      .eq('user_id', userId);

    if (receiptsError) {
      logger.error('Error deleting receipts', { error: receiptsError, userId });
      deletionResults.readReceipts = `error: ${receiptsError.message}`;
    } else {
      deletionResults.readReceipts = 'deleted';
    }

    // 6. Delete blocks
    const blocksFrom = await db.collection('blocked_users')
      .where('from_user_id', '==', userId)
      .get();

    const blocksTo = await db.collection('blocked_users')
      .where('to_user_id', '==', userId)
      .get();

    const blockDeletions = [];
    [...blocksFrom.docs, ...blocksTo.docs].forEach(doc => {
      blockDeletions.push(doc.ref.delete());
    });
    await Promise.all(blockDeletions);
    deletionResults.blocks = `${blockDeletions.length} deleted`;

    // 7. Handle reports based on options
    if (!keepReports) {
      const reportsSnapshot = await db.collection('reported_users')
        .where('reporter_id', '==', userId)
        .get();

      const reportDeletions = [];
      reportsSnapshot.forEach(doc => {
        reportDeletions.push(doc.ref.delete());
      });
      await Promise.all(reportDeletions);
      deletionResults.reports = `${reportDeletions.length} deleted`;
    } else {
      deletionResults.reports = 'kept for compliance';
    }

    // 8. Handle audit logs based on options
    if (!keepAuditLogs) {
      const auditLogsSnapshot = await db.collection('audit_logs')
        .where('userId', '==', userId)
        .get();

      const auditDeletions = [];
      auditLogsSnapshot.forEach(doc => {
        auditDeletions.push(doc.ref.delete());
      });
      await Promise.all(auditDeletions);
      deletionResults.auditLogs = `${auditDeletions.length} deleted`;
    } else {
      deletionResults.auditLogs = 'kept for compliance';
    }

    // Log the deletion
    await logAuditEvent({
      type: AuditEventType.ADMIN_USER_DELETE,
      userId: adminUserId || userId,
      targetUserId: userId,
      metadata: {
        deletionResults,
        keepAuditLogs,
        keepReports
      }
    });

    logger.info('GDPR data deletion completed', { userId, deletionResults });

    return {
      success: true,
      deletionResults
    };

  } catch (error) {
    logger.error('GDPR data deletion failed', { error: error.message, userId });
    return {
      success: false,
      error: error.message,
      partialResults: deletionResults
    };
  }
}

module.exports = {
  exportUserData,
  deleteUserData
};
