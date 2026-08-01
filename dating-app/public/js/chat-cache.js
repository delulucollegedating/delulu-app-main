// ===== IndexedDB Local Chat Cache (via Dexie) =====
// Provides instant render on chat open + offline outbox + delta sync
// v2: Added compound index for efficient cursor-based pagination (oldest-first history load)

const CHAT_CACHE_DB = new Dexie('DeluluChatCache');

// v1 schema (preserved — Dexie requires all versions listed)
CHAT_CACHE_DB.version(1).stores({
  messages: '&id, connection_id, created_at, sender_id',
  pending: '&client_uuid, connection_id, created_at',
  meta: '&key'
});

// v2 schema — adds compound index for efficient time-cursor queries
// The [connection_id+created_at] compound index powers getCachedOlderMessages()
// without doing a full table scan of potentially thousands of cached messages.
CHAT_CACHE_DB.version(2).stores({
  messages: '&id, connection_id, created_at, sender_id, [connection_id+created_at]',
  pending: '&client_uuid, connection_id, created_at',
  meta: '&key'
});

// Meta keys
const META_LAST_SYNC = (connId) => `last_sync_${connId}`;

// ===== Message Cache =====
const messageCache = {
  async cacheMessages(connectionId, messages) {
    if (!messages || messages.length === 0) return;
    const tx = CHAT_CACHE_DB.transaction('rw', CHAT_CACHE_DB.messages, CHAT_CACHE_DB.meta, async () => {
      // Upsert each message
      for (const m of messages) {
        await CHAT_CACHE_DB.messages.put({
          ...m,
          id: Number(m.id) || m.id,
          connection_id: String(connectionId),
          created_at: m.created_at || new Date().toISOString()
        });
      }
      // Update last sync timestamp
      const times = messages.map(m => m.created_at).filter(Boolean).sort();
      if (times.length > 0) {
        await CHAT_CACHE_DB.meta.put({ key: META_LAST_SYNC(connectionId), value: times[times.length - 1] });
      }
    });
    return tx;
  },

  async cacheSingleMessage(connectionId, msg) {
    if (!msg || !msg.id) return;
    try {
      await CHAT_CACHE_DB.messages.put({
        ...msg,
        id: Number(msg.id),
        connection_id: String(connectionId),
        created_at: msg.created_at || new Date().toISOString()
      });
    } catch (e) {
      // Silently fail cache writes
    }
  },

  /**
   * Get the latest N cached messages for a connection (cold open / initial render).
   * Returns oldest-first so the UI flex-col-reverse layout renders newest at bottom.
   * @param {string|number} connectionId
   * @param {number} limit  Max messages to return (default 30 — matches server page size)
   */
  async getCachedMessages(connectionId, limit = 30) {
    try {
      // Use the compound index to sort by [connection_id, created_at] efficiently
      const all = await CHAT_CACHE_DB.messages
        .where('[connection_id+created_at]')
        .between(
          [String(connectionId), Dexie.minKey],
          [String(connectionId), Dexie.maxKey]
        )
        .reverse()           // newest first
        .limit(limit)
        .toArray();

      // Reverse back to oldest-first for rendering
      return all.reverse();
    } catch (e) {
      // Fallback to old query if compound index isn't ready yet
      try {
        const msgs = await CHAT_CACHE_DB.messages
          .where('connection_id')
          .equals(String(connectionId))
          .sortBy('created_at');
        return msgs.slice(-limit);
      } catch (e2) {
        return [];
      }
    }
  },

  /**
   * Get cached messages OLDER than a given timestamp (infinite scroll / load more).
   * Used when the user scrolls to the top and requests history.
   * @param {string|number} connectionId
   * @param {string} beforeTimestamp  ISO string — fetch messages with created_at < this
   * @param {number} limit
   */
  async getCachedOlderMessages(connectionId, beforeTimestamp, limit = 30) {
    try {
      const msgs = await CHAT_CACHE_DB.messages
        .where('[connection_id+created_at]')
        .between(
          [String(connectionId), Dexie.minKey],
          [String(connectionId), beforeTimestamp],
          false, false           // exclusive upper bound
        )
        .reverse()               // newest-of-the-older-page first
        .limit(limit)
        .toArray();

      // Reverse to oldest-first for prepending to chat UI
      return msgs.reverse();
    } catch (e) {
      return [];
    }
  },

  async getLastMessageTime(connectionId) {
    try {
      const entry = await CHAT_CACHE_DB.meta.get(META_LAST_SYNC(connectionId));
      return entry ? entry.value : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Get the oldest cached message's timestamp for this connection.
   * Used as the `before` cursor when requesting more history from the server.
   */
  async getOldestMessageTime(connectionId) {
    try {
      const msgs = await CHAT_CACHE_DB.messages
        .where('[connection_id+created_at]')
        .between(
          [String(connectionId), Dexie.minKey],
          [String(connectionId), Dexie.maxKey]
        )
        .limit(1)
        .toArray();

      return msgs.length > 0 ? msgs[0].created_at : null;
    } catch (e) {
      // Fallback
      try {
        const all = await CHAT_CACHE_DB.messages
          .where('connection_id').equals(String(connectionId))
          .sortBy('created_at');
        return all.length > 0 ? all[0].created_at : null;
      } catch (e2) {
        return null;
      }
    }
  },

  /**
   * Total count of cached messages for a connection.
   * Lets the client know if the local cache can serve "Load More" or if it must hit the network.
   */
  async getTotalCachedCount(connectionId) {
    try {
      return await CHAT_CACHE_DB.messages
        .where('connection_id')
        .equals(String(connectionId))
        .count();
    } catch (e) {
      return 0;
    }
  }
};

// ===== Offline Outbox Queue =====
const outboxQueue = {
  async enqueue(message) {
    try {
      await CHAT_CACHE_DB.pending.put({
        ...message,
        client_uuid: message.client_uuid || ('out-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
        created_at: message.created_at || new Date().toISOString(),
        retry_count: 0
      });
    } catch (e) {
      console.warn('Outbox enqueue failed:', e);
    }
  },

  notify(type, detail) {
    try {
      window.dispatchEvent(new CustomEvent(type, { detail }));
    } catch (e) {}
  },

  async dequeue(clientUuid) {
    try {
      await CHAT_CACHE_DB.pending.delete(clientUuid);
    } catch (e) {}
  },

  async getAllPending(connectionId) {
    try {
      if (connectionId) {
        return await CHAT_CACHE_DB.pending
          .where('connection_id')
          .equals(String(connectionId))
          .toArray();
      }
      return await CHAT_CACHE_DB.pending.toArray();
    } catch (e) {
      return [];
    }
  },

  async flushPending() {
    try {
      const all = await CHAT_CACHE_DB.pending.toArray();
      for (const item of all) {
        // Keep terminal failures instead of silently deleting a person's words.
        // The chat UI can surface a retry action; data stays safely on-device.
        if ((item.retry_count || 0) >= 5) {
          if (!item.terminal_notified) {
            await CHAT_CACHE_DB.pending.update(item.client_uuid, { terminal_notified: 1 });
            outboxQueue.notify('outbox-message-failed', item);
          }
          continue;
        }
        
        try {
          const payload = {
            connection_id: item.connection_id,
            content: item.content,
            client_uuid: item.client_uuid
          };
          if (item.is_encrypted) {
            payload.is_encrypted = 1;
            payload.iv = item.iv;
          }
          const res = await fetch(resolveUrl('/api/messages/send'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (res.status === 400) {
            // Permanently rejected (e.g. blocked/forbidden content) — drop, never retry
            await outboxQueue.dequeue(item.client_uuid);
            continue;
          }
          if (res.ok && data.success) {
            await outboxQueue.dequeue(item.client_uuid);
            outboxQueue.notify('outbox-message-sent', { item, message: data.message });
          } else {
            // Increment retry count for non-API errors (server returned error)
            try {
              await CHAT_CACHE_DB.pending.update(item.client_uuid, {
                retry_count: (item.retry_count || 0) + 1,
                terminal_notified: 0
              });
            } catch (e) {}
          }
        } catch (e) {
          // Network failure — increment retry count
          try {
            await CHAT_CACHE_DB.pending.update(item.client_uuid, {
              retry_count: (item.retry_count || 0) + 1,
              terminal_notified: 0
            });
          } catch (innerErr) {}
          console.warn('Outbox flush item failed (will retry):', e);
        }
      }
    } catch (e) {
      console.warn('Outbox flush failed:', e);
    }
  }
};

// ===== Multi-Tab Sync via BroadcastChannel =====
let broadcastChannel = null;

function initBroadcastChannel(connectionId, onEvent) {
  try {
    if (broadcastChannel) broadcastChannel.close();
    broadcastChannel = new BroadcastChannel(`delulu-chat-${connectionId}`);
    broadcastChannel.onmessage = (event) => {
      if (onEvent) onEvent(event.data);
    };
  } catch (e) {
    // BroadcastChannel not supported
  }
}

function broadcastToTabs(data) {
  try {
    if (broadcastChannel) {
      broadcastChannel.postMessage(data);
    }
  } catch (e) {}
}

function closeBroadcastChannel() {
  try {
    if (broadcastChannel) {
      broadcastChannel.close();
      broadcastChannel = null;
    }
  } catch (e) {}
}

// ===== Periodic Outbox Flush =====
// Runs on an interval so pending messages get sent even when no socket is active.
// The interval automatically short-ciruits when the outbox is empty (quick IndexedDB read).
let _outboxFlushInterval = null;

function startOutboxFlush(intervalMs = 15000) {
  stopOutboxFlush();
  _outboxFlushInterval = setInterval(() => {
    outboxQueue.flushPending().catch(() => {});
  }, intervalMs);
}

function stopOutboxFlush() {
  if (_outboxFlushInterval) {
    clearInterval(_outboxFlushInterval);
    _outboxFlushInterval = null;
  }
}
