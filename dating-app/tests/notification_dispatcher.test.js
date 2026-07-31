import { describe, it, expect, vi, beforeEach } from 'vitest';
const notificationDispatcher = require('../services/notificationDispatcher');

describe('NotificationDispatcher Service', () => {
  it('should validate missing parameters on registerDevice', async () => {
    const res = await notificationDispatcher.registerDevice(null, {});
    expect(res.error).toBe('Missing userId or deviceId');
  });

  it('should validate missing parameters on unregisterDevice', async () => {
    const res = await notificationDispatcher.unregisterDevice(null, null);
    expect(res.error).toBe('Missing userId or deviceId');
  });

  it('should return empty device list for invalid userId', async () => {
    const devices = await notificationDispatcher.getActiveDevices(null);
    expect(devices).toEqual([]);
  });

  it('should bypass push dispatch if receiver is active in SSE stream', async () => {
    const activePresenceChecker = (recId, connId) => recId === 101 && connId === 202;
    const result = await notificationDispatcher.dispatchNotification(
      101,
      202,
      { title: 'Hello', body: 'World' },
      activePresenceChecker
    );
    expect(result).toEqual({ dispatched: false, reason: 'user_active_in_sse_stream' });
  });

  it('should report missing receiver if receiverId is null', async () => {
    const result = await notificationDispatcher.dispatchNotification(null, 202, {});
    expect(result).toEqual({ dispatched: false, reason: 'missing_receiver' });
  });
});
