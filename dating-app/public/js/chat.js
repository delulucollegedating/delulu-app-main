let currentConnId = null;
let currentChatOther = '';
let myPrivateKey = null;
let otherPublicKey = null;
let sharedSecretKey = null;
let isE2EEActive = false;
let closeModalTimeout = null;
let otherUserId = null;
let otherLastReadAt = null;
let myLastReadAt = null;
let hasReadMessagesInView = false;
let hasUnreadMessagesInView = false;
let unreadIncomingCount = 0;
let lastMessageTimestamp = null;
let hasLoadedInitialMessages = false;
let pollingTimeout = null;
let pollInterval = 3000;
const maxInterval = 8000;

// The message container uses flex-col-reverse: visual latest is scrollTop 0
// (or very close to it across mobile browsers). Never pull a reader away from
// history just because a new event or background refresh arrives.
function isViewingLatestMessages() {
  const cont = document.getElementById('chat-messages');
  return !!cont && Math.abs(cont.scrollTop) < 120;
}

function updateNewMessagesButton() {
  const button = document.getElementById('btn-scroll-bottom');
  const badge = document.getElementById('new-messages-badge');
  if (!button || !badge) return;
  if (unreadIncomingCount > 0) {
    badge.textContent = unreadIncomingCount > 99 ? '99+' : String(unreadIncomingCount);
    badge.classList.remove('hidden');
    button.title = `Jump to ${unreadIncomingCount} new message${unreadIncomingCount === 1 ? '' : 's'}`;
  } else {
    badge.classList.add('hidden');
    button.title = 'Scroll to latest messages';
  }
}

function recordIncomingMessage() {
  hasReadMessagesInView = false;
  hasUnreadMessagesInView = true;
  if (!isViewingLatestMessages()) {
    unreadIncomingCount += 1;
    updateNewMessagesButton();
    const button = document.getElementById('btn-scroll-bottom');
    if (button) {
      button.classList.remove('opacity-0', 'pointer-events-none');
      button.classList.add('opacity-100', 'pointer-events-auto');
    }
    return false;
  }
  return true;
}

// ── Pagination State ─────────────────────────────────────────────────────────
// Tracks infinite-scroll-upward state for loading older message history.
let hasMoreMessages = false;       // true when server says there are older pages
let oldestMessageTimestamp = null; // ISO string — used as 'before' cursor
let _loadingOlderMessages = false; // guard to prevent duplicate requests
let _topSentinelObserver = null;   // IntersectionObserver for the top sentinel div

// SSE realtime stream for connection state and message nudges.
// It keeps chat updates instant while avoiding repeated full HTTP polling.
let eventSource = null;
let streamReady = false;
let isReconnecting = false;
let statusPollingTimeout = null;

// Guard to prevent redundant loadChatInfo() calls from SSE reconnection,
// socket connect, and visibilitychange from all firing at once.
let _chatInfoLoading = false;
let _chatInfoQueued = false;

// User Activity Monitoring to prevent wasteful reads when the user is idle
let lastActivityTime = Date.now();
let isIdle = false;

function resetIdleTimer() {
  lastActivityTime = Date.now();
  if (isIdle) {
    isIdle = false;
    console.log('User active — resuming polling fallback');
    pollInterval = 3000;
    scheduleNextPoll();
  }
}

// Activity listeners to track if the user is interacting with the page
['keydown', 'mousemove', 'mousedown', 'touchstart', 'scroll'].forEach(evt => {
  window.addEventListener(evt, resetIdleTimer, { passive: true });
});

function checkUserIdle() {
  // Idle after 30 seconds of no keyboard/mouse/touch activity — shorter threshold
  // reduces the window where incoming messages are delayed by backed-off polling
  if (Date.now() - lastActivityTime > 30000) {
    isIdle = true;
    return true;
  }
  return false;
}

async function pollDelta() {
  if (!currentConnId) return false;
  try {
    const since = getDeltaSinceParam(lastMessageTimestamp);
    const data = await apiCall(`/api/messages/${currentConnId}${since ? '?since=' + encodeURIComponent(since) : ''}`);
    
    if (data.messages && data.messages.length > 0) {
      const latestMsg = data.messages[data.messages.length - 1];
      if (latestMsg.created_at) {
        lastMessageTimestamp = latestMsg.created_at;
      }
      const cont = document.getElementById('chat-messages');
      const existingIds = new Set();
      cont.querySelectorAll('[data-msg-id]').forEach(el => {
        existingIds.add(el.getAttribute('data-msg-id'));
      });
      
      const newMsgs = data.messages.filter(m => !existingIds.has(String(m.id)));
      if (newMsgs.length > 0) {
        const otherNewMsgs = newMsgs.filter(m => Number(m.sender_id) !== Number(currentUser.id));
        if (otherNewMsgs.length > 0) {
          otherNewMsgs.forEach(recordIncomingMessage);
        }
        for (const m of newMsgs) {
          await appendMessage(m, false);
        }
        if (isViewingLatestMessages()) scrollToBottom();
        
        if (typeof messageCache !== 'undefined') {
          await messageCache.cacheMessages(currentConnId, data.messages);
        }
        if (isViewingLatestMessages()) setTimeout(() => markMessagesAsRead(), 300);
        return true;
      }
    }
  } catch (err) {
    console.error('pollDelta error:', err);
  }
  return false;
}

let _pollInFlight = false;
let _deltaQueued = false;
let _deltaSyncSoonTimeout = null;

function getDeltaSinceParam(timestamp) {
  if (!timestamp) return null;
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return timestamp;
  return new Date(parsed - 15000).toISOString();
}

async function runDeltaSyncNow() {
  if (_pollInFlight) {
    _deltaQueued = true;
    return false;
  }
  _pollInFlight = true;
  try {
    return await pollDelta();
  } finally {
    _pollInFlight = false;
    if (_deltaQueued) {
      _deltaQueued = false;
      setTimeout(() => runDeltaSyncNow().catch(() => {}), 100);
    }
  }
}

function scheduleDeltaSyncSoon() {
  if (_deltaSyncSoonTimeout) return;
  _deltaSyncSoonTimeout = setTimeout(() => {
    _deltaSyncSoonTimeout = null;
    runDeltaSyncNow().then((hasNew) => {
      if (hasNew) pollInterval = 8000;
    }).catch(() => {});
  }, 75);
}

function scheduleNextPoll() {
  if (pollingTimeout) clearTimeout(pollingTimeout);
  if (socket && socket.connected) return; // Don't poll if socket is alive
  if (streamReady) return; // SSE delivers message events while healthy
  if (document.hidden || checkUserIdle()) return; // Pause entirely if backgrounded or idle
  if (_pollInFlight) {
    // Reschedule for after current poll completes to prevent stacking
    pollingTimeout = setTimeout(scheduleNextPoll, pollInterval);
    return;
  }
  
  pollingTimeout = setTimeout(async () => {
    if (_pollInFlight) return;
    const hasNewMessages = await runDeltaSyncNow();
    // Aggressive polling: reset to 3s on any activity, max 8s on prolonged silence
    pollInterval = hasNewMessages
      ? 3000
      : Math.min(pollInterval * 1.5, maxInterval);
    scheduleNextPoll();
  }, pollInterval);
}

function startPollingFallback() {
  if (socket && socket.connected) return;
  pollInterval = 3000; // Start fast — 3s instead of 8s
  scheduleNextPoll();
}

function stopPollingFallback() {
  if (pollingTimeout) {
    clearTimeout(pollingTimeout);
    pollingTimeout = null;
  }
}

// ── Firestore Connection Listener ───────────────────────────────────────────
// Replaces HTTP polling for connection state (status, game, reveal fields).
// Subscribes to a single document via onSnapshot — cheap, instant, no race conditions.
// Falls back to polling if Firebase client config is not set.
let _fsSanitizedCache = null;

function clientSanitizeConnection(c, userId) {
  if (!c) return null;
  const isFrom = Number(c.from_user_id) === Number(userId);
  
  const fromIdentityReveal = c.from_identity_reveal !== undefined ? c.from_identity_reveal : (c.reveal_from || 0);
  const toIdentityReveal = c.to_identity_reveal !== undefined ? c.to_identity_reveal : (c.reveal_to || 0);
  const identityRevealAvailable = c.identity_reveal_available_at || c.reveal_available_at || null;
  const faceRevealAvailable = c.face_reveal_available_at || c.reveal_available_at || null;
  
  return {
    ...c,
    identity_reveal_available_at: identityRevealAvailable,
    face_reveal_available_at: faceRevealAvailable,
    my_identity_reveal: isFrom ? fromIdentityReveal : toIdentityReveal,
    other_identity_reveal: isFrom ? toIdentityReveal : fromIdentityReveal,
    both_identity_revealed: fromIdentityReveal === 1 && toIdentityReveal === 1,
    my_face_reveal: isFrom ? (c.from_face_reveal || 0) : (c.to_face_reveal || 0),
    other_face_reveal: isFrom ? (c.to_face_reveal || 0) : (c.from_face_reveal || 0),
    both_face_revealed: (c.from_face_reveal || 0) === 1 && (c.to_face_reveal || 0) === 1,
    face_reveal_declined_by_other: isFrom 
      ? c.face_reveal_declined_by === c.to_user_id 
      : c.face_reveal_declined_by === c.from_user_id
  };
}

function initRealtimeStream() {
  if (!currentConnId || eventSource) return;

  console.log('[SSE] Connecting to real-time event stream...');
  eventSource = new EventSource(resolveUrl(`/api/connections/${currentConnId}/stream`), { withCredentials: true });

  eventSource.onopen = () => {
    console.log('[SSE] Connection established successfully.');
    streamReady = true;
    stopPollingFallback();
    stopStatusPollingFallback();

    // Resync connection state & fetch message delta when connecting/reconnecting
    console.log('[SSE] Stream connected. Syncing connection info & message state.');
    scheduleChatInfoRefresh();
    if (currentConnId && typeof loadMessages === 'function') {
      // The stream already contains message payloads. A delta refresh repairs
      // missed events without replacing the reader's current viewport.
      loadMessages(false).catch(() => {});
    }
    isReconnecting = false;
  };

  eventSource.onmessage = (event) => {
    let streamEvent = { type: event.data };
    try {
      if (event.data && event.data.startsWith('{')) {
        streamEvent = JSON.parse(event.data);
      }
    } catch (e) {
      streamEvent = { type: event.data };
    }

    if (streamEvent.type === 'game') {
      console.log('[SSE] Received game update event. Refreshing chat state...');
      if (Object.prototype.hasOwnProperty.call(streamEvent, 'active_game')) {
        syncActiveGame({
          from_user_id: streamEvent.from_user_id,
          to_user_id: streamEvent.to_user_id,
          active_game: streamEvent.active_game
        });
      } else {
        scheduleChatInfoRefresh();
      }
    } else if (streamEvent.type === 'message') {
      // Server now embeds the full message object in the SSE payload.
      // If it's present and from the other user, append it directly — zero extra HTTP round-trip.
      if (streamEvent.msg && Number(streamEvent.senderId) !== Number(currentUser.id)) {
        const alreadyExists = document.querySelector(`[data-msg-id="${streamEvent.msg.id}"]`);
        if (!alreadyExists) {
          const shouldFollow = recordIncomingMessage();
          appendMessage({ ...streamEvent.msg }, shouldFollow).then(() => {
            if (shouldFollow) markMessagesAsRead();
          }).catch(() => {});
          // Fire native notification if the app/tab is in the background
          if (document.hidden && typeof window.showNativeNotification === 'function') {
            window.showNativeNotification({
              title: 'New message',
              body: streamEvent.msg.content || 'You have a new message',
              url: `chat.html?id=${currentConnId}`,
              id: streamEvent.msg.id
            });
          }
        }
      } else if (!streamEvent.msg) {
        // Fallback: old-style SSE with no embedded message — do a delta fetch
        scheduleDeltaSyncSoon();
      }
      // Reset poll interval on any incoming message activity — ensures polling stays fast
      pollInterval = 3000;
    } else if (streamEvent.type === 'read') {
      // Instantly update seen ticks without any extra fetch
      if (streamEvent.readAt) {
        otherLastReadAt = streamEvent.readAt;
        document.querySelectorAll('[data-msg-id]').forEach(el => {
          const statusIcon = el.querySelector('.msg-status-icon');
          if (statusIcon) {
            statusIcon.innerHTML = '<span class="text-[11px] text-blue-500 material-symbols-outlined text-[14px] align-middle" style="font-variation-settings: \'FILL\' 1">done_all</span>';
          }
        });
      }
    } else if (streamEvent.type === 'typing') {
      if (Number(streamEvent.userId) !== Number(currentUser.id)) {
        handleOtherUserTyping(streamEvent.isTyping);
      }
    } else if (streamEvent.type === 'presence') {
      if (Array.isArray(streamEvent.onlineUserIds)) {
        const isOtherOnline = streamEvent.onlineUserIds.some(id => Number(id) !== Number(currentUser.id));
        handlePresenceChange(isOtherOnline);
      } else if (Number(streamEvent.userId) !== Number(currentUser.id)) {
        handlePresenceChange(streamEvent.status === 'online');
      }
    } else if (streamEvent.type === 'messages') {
      console.log('[SSE] Received message update event. Refreshing messages...');
      loadMessages(false, true).catch(() => {});
    } else if (streamEvent.type === 'ended') {
      sessionStorage.setItem('connection_ended_message', 'This chat has ended.');
      window.location.href = 'discover.html';
    }
  };

  eventSource.onerror = () => {
    console.warn('[SSE] EventSource disconnected. Falling back to HTTP polling.');
    
    streamReady = false;
    isReconnecting = true;
    
    // Start HTTP polling fallback immediately — with aggressive 3s base interval
    startPollingFallback();
    startStatusPollingFallback();
  };
}

function stopRealtimeStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  streamReady = false;
}

// Dedicated connection status polling fallback when SSE stream is not available
function startStatusPollingFallback() {
  if (statusPollingTimeout) clearTimeout(statusPollingTimeout);
  if (streamReady) return;
  if (document.hidden || checkUserIdle()) {
    statusPollingTimeout = setTimeout(startStatusPollingFallback, 3000);
    return;
  }
  
  statusPollingTimeout = setTimeout(async () => {
    if (!streamReady) {
      try {
        await loadChatInfo();
      } catch (e) {}
    }
    startStatusPollingFallback();
  }, 3000); // Poll status every 3s (halved from 6s) for snappier game/reveal updates
}

function stopStatusPollingFallback() {
  if (statusPollingTimeout) {
    clearTimeout(statusPollingTimeout);
    statusPollingTimeout = null;
  }
}

// Helper: format relative time for status
function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

// Helper: create date divider element
function createDateDivider(dateStr) {
  const now = new Date();
  const msgDate = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());
  const diffDays = Math.floor((today - msgDay) / (1000 * 60 * 60 * 24));
  
  let label;
  if (diffDays === 0) label = 'Today';
  else if (diffDays === 1) label = 'Yesterday';
  else if (diffDays < 7) {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    label = days[msgDate.getDay()];
  } else {
    label = msgDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  
  const div = document.createElement('div');
  div.className = 'flex justify-center my-3 fade-in';
  div.innerHTML = `<span class="px-4 py-1 rounded-full bg-surface-variant/60 text-on-surface-variant text-[11px] font-semibold backdrop-blur-sm">${label}</span>`;
  return div;
}

// Check if message should show read status
function isMessageRead(msg) {
  if (Number(msg.sender_id) !== Number(currentUser.id)) return false; // Only show for own messages
  // If the message is deleted, don't show read status (the field is deleted_at, not deleted)
  if (msg.deleted_at) return false;
  if (otherLastReadAt && msg.created_at) {
    return new Date(msg.created_at) <= new Date(otherLastReadAt);
  }
  return false;
}

function isUnreadFromOther(msg) {
  if (!msg || !currentUser || Number(msg.sender_id) === Number(currentUser.id) || msg.deleted_at) return false;
  if (!myLastReadAt) return true;
  if (!msg.created_at) return false;
  return new Date(msg.created_at) > new Date(myLastReadAt);
}

async function initializeChat() {
  try {
    await requireAuth();
  } catch (err) {
    console.error('initializeChat requireAuth failed:', err);
    return;
  }
  
  const urlParams = new URLSearchParams(window.location.search);
  const connId = urlParams.get('id');
  if (!connId) {
    window.location.href = 'messages.html';
    return;
  }
  
  currentConnId = connId;
  lastMessageTimestamp = null;
  hasLoadedInitialMessages = false;
  // Reset pagination state for the new chat thread
  hasMoreMessages = false;
  oldestMessageTimestamp = null;
  _loadingOlderMessages = false;
  if (_topSentinelObserver) {
    _topSentinelObserver.disconnect();
    _topSentinelObserver = null;
  }
  loadChatInfo();
  
  // ── Socket setup ──────────────────────────────────────────────────────────
  // We need to guard against duplicate listener registration (e.g. hot module
  // reload or double-call). Socket.io listeners accumulate if not cleaned up.
  function setupChatSocketListeners() {
    if (!socket) return;

    // Remove any previously registered chat-specific listeners to prevent doubles
    socket.off('new-message');
    socket.off('message-reacted');
    socket.off('message-deleted');
    socket.off('messages-read');
    socket.off('user-online');
    socket.off('user-offline');
    socket.off('presence-bulk');
    socket.off('typing');
    socket.off('status_change');
    socket.off('connection-ended');
    socket.off('game_update');

    socket.off('identity-revealed');
    socket.off('face-revealed');
    socket.off('face-reveal-declined');

    socket.on('new-message', (msg) => {
      // Use Number() coercion for safe comparison regardless of int/string type
      if (Number(msg.connection_id) === Number(currentConnId)) {
        if (Number(msg.sender_id) !== Number(currentUser.id)) {
          const shouldFollow = recordIncomingMessage();
          appendMessage(msg, shouldFollow);
          if (shouldFollow) markMessagesAsRead();
          
          // Cache incoming message
          if (typeof messageCache !== 'undefined') {
            messageCache.cacheSingleMessage(currentConnId, msg).catch(() => {});
          }
        } else {
          // Update our own sent message: replace temp if needed
          const tempEl = document.querySelector(`[data-temp-id="${msg.tempId || ''}"]`);
          if (tempEl) {
            tempEl.removeAttribute('data-temp-id');
            tempEl.setAttribute('data-msg-id', msg.id);
            
            // Cache our own sent message
            if (typeof messageCache !== 'undefined') {
              messageCache.cacheSingleMessage(currentConnId, msg).catch(() => {});
            }
          }
        }
      }
    });

    socket.on('message-reacted', ({ messageId, reactions }) => {
      const el = document.querySelector(`[data-msg-id="${messageId}"]`);
      if (el) {
        const inner = el.querySelector('.rounded-2xl');
        renderReactions({ id: messageId, reactions }, inner);
      }
    });

    socket.on('message-deleted', ({ messageId }) => {
      const el = document.querySelector(`[data-msg-id="${messageId}"]`);
      if (el) {
        const inner = el.querySelector('.rounded-2xl');
        inner.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'text-[15px] italic opacity-70 break-words';
        p.textContent = 'This message was deleted';
        inner.appendChild(p);
        const timeEl = document.createElement('div');
        timeEl.className = 'text-[10px] mt-1 text-right text-on-surface-variant/70';
        timeEl.textContent = 'deleted';
        inner.appendChild(timeEl);
        const btn = el.querySelector('.more-actions-btn');
        if (btn) btn.remove();
      }
    });

    socket.on('messages-read', (data) => {
      if (data.connectionId == currentConnId) {
        // Use the read timestamp from the server if provided, otherwise fall back to client time
        otherLastReadAt = data.readAt || new Date().toISOString();
        document.querySelectorAll('[data-msg-id]').forEach(el => {
          const statusIcon = el.querySelector('.msg-status-icon');
          if (statusIcon) {
            statusIcon.innerHTML = '<span class="text-[11px] text-blue-500 material-symbols-outlined text-[14px] align-middle" style="font-variation-settings: \'FILL\' 1">done_all</span>';
          }
        });
        if (typeof broadcastToTabs !== 'undefined') {
          broadcastToTabs({ type: 'messages-read', connectionId: currentConnId, at: otherLastReadAt });
        }
      }
    });

    socket.on('user-online', (data) => {
      if (data.userId === otherUserId) {
        const statusEl = document.getElementById('chat-status');
        if (statusEl && !statusEl.querySelector('.animate-pulse')) {
          statusEl.innerHTML = `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-500 inline-block"></span> Online</span>`;
        }
      }
    });

    socket.on('user-offline', (data) => {
      if (data.userId === otherUserId) {
        const statusEl = document.getElementById('chat-status');
        if (statusEl) statusEl.innerHTML = `Last seen ${formatRelativeTime(data.lastSeen)}`;
      }
    });

    socket.on('presence-bulk', (statuses) => {
      if (otherUserId && statuses[otherUserId] !== undefined) {
        updatePresenceDisplay(statuses[otherUserId]);
      }
    });

    let originalStatus = '';
    socket.on('typing', (data) => {
      if (data.userId !== currentUser.id) {
        const statusEl = document.getElementById('chat-status');
        if (data.isTyping) {
          if (!originalStatus) originalStatus = statusEl.innerHTML;
          statusEl.innerHTML = `<span class="italic animate-pulse">typing...</span>`;
        } else {
          if (originalStatus) { statusEl.innerHTML = originalStatus; originalStatus = ''; }
        }
      }
    });

    socket.on('connection-ended', ({ connectionId, message }) => {
      if (connectionId == currentConnId) {
        // Set sessionStorage guard to prevent Firestore listener from double-alerting
        sessionStorage.setItem('fs_redirected_' + connectionId, '1');
        // Store message for display on the discover page after redirect
        sessionStorage.setItem('connection_ended_message', message);
        window.location.href = 'discover.html';
      }
    });
    
    socket.on('status_change', (data) => {
      if (Number(data.connection_id) === Number(currentConnId)) {
        if (!streamReady) {
          console.log('[Socket] status_change received — updating chat info');
          loadChatInfo();
        }
      }
    });
    

    socket.on('game_update', (data) => {
      const connId = data.connection_id || data.connectionId;
      if (Number(connId) === Number(currentConnId)) {
        console.log('[Socket] game_update received:', data);
        syncActiveGame({
          from_user_id: data.from_user_id,
          to_user_id: data.to_user_id,
          active_game: data.active_game
        });
      }
    });

    socket.on('identity-revealed', (data) => {
      if (data.connection_id == currentConnId) {
        // This event only fires when BOTH have revealed (server condition).
        // Meeting code is always present — show modal and update status directly.
        if (data.meeting_code) showMeetingModal(data.meeting_code);
        
        // Update status bar directly — no API fetch needed
        const statusEl = document.getElementById('chat-status');
        if (statusEl && data.meeting_code) {
          statusEl.innerHTML = `<span class="flex items-center gap-1 text-green-600"><span class="material-symbols-outlined text-[14px]">videocam</span> Meeting ready! <a href="#" onclick="showMeetingModal('${data.meeting_code}'); return false;" class="underline font-semibold">Join</a></span>`;
        }
        // Hide the reveal button since both agreed
        const idBtn = document.getElementById('btn-identity-reveal');
        if (idBtn) idBtn.classList.add('hidden');
      }
    });
    
    socket.on('face-revealed', (data) => {
      if (data.connection_id == currentConnId) {
        // This event only fires when BOTH have revealed (server condition).
        // Meeting code is always present — show modal and update status directly.
        if (data.meeting_code) showMeetingModal(data.meeting_code);
        
        // Update status bar directly — no API fetch needed
        const statusEl = document.getElementById('chat-status');
        if (statusEl && data.meeting_code) {
          statusEl.innerHTML = `<span class="flex items-center gap-1 text-green-600"><span class="material-symbols-outlined text-[14px]">videocam</span> Ready to meet! <a href="#" onclick="showMeetingModal('${data.meeting_code}'); return false;" class="underline font-semibold">Join</a></span>`;
        }
        // Hide the face reveal button since both agreed
        const faceBtn = document.getElementById('btn-face-reveal');
        if (faceBtn) faceBtn.classList.add('hidden');
      }
    });
    
    socket.on('face-reveal-declined', (data) => {
      if (data.connectionId == currentConnId) {
        // Update status directly — no API fetch needed
        const statusEl = document.getElementById('chat-status');
        if (statusEl) statusEl.textContent = 'Face reveal was declined.';
        // Hide the face reveal button
        const faceBtn = document.getElementById('btn-face-reveal');
        if (faceBtn) faceBtn.classList.add('hidden');
        // Show the declined modal
        openModal('modal-face-declined');
      }
    });
  }

  function joinChatRoom() {
    if (!socket || !currentConnId) return;
    socket.emit('join-chat', currentConnId);
    if (typeof outboxQueue !== 'undefined') {
      // flushPending uses fetch internally — socket param is ignored but harmless
      outboxQueue.flushPending().catch(() => {});
    }
    if (typeof initBroadcastChannel !== 'undefined') {
      initBroadcastChannel(currentConnId, (data) => {
        if (data.type === 'messages-read' && data.connectionId == currentConnId) {
          otherLastReadAt = data.at || new Date().toISOString();
          document.querySelectorAll('[data-msg-id]').forEach(el => {
            const statusIcon = el.querySelector('.msg-status-icon');
            if (statusIcon) {
              statusIcon.innerHTML = '<span class="text-[11px] text-blue-500 material-symbols-outlined text-[14px] align-middle" style="font-variation-settings: \'FILL\' 1">done_all</span>';
            }
          });
        }
      });
    }
  }

  // Production client delivery is SSE. The shared socket object is a deliberate
  // no-op compatibility shim, so never register a second realtime pipeline on it.
  if (socket && !socket.isMock) {
    // Register all message/presence listeners once
    setupChatSocketListeners();

    // Remove previously registered connection-lifecycle listeners (by reference)
    // to prevent duplicate handlers while not affecting other modules' handlers.
    if (window.__chatSocketHandlers) {
      const { onDisconnect, onConnect, onReconnectError, onRoomJoined } = window.__chatSocketHandlers;
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
      socket.off('reconnect_error', onReconnectError);
      socket.off('room-joined', onRoomJoined);
    }

    const onDisconnect = () => {
      const bar = document.getElementById('chat-connection-bar');
      if (bar) {
        bar.classList.remove('hidden');
        const barText = document.getElementById('connection-bar-text');
        if (barText) barText.textContent = 'Reconnecting...';
      }
      startPollingFallback();
    };
    const onConnect = () => {
      const bar = document.getElementById('chat-connection-bar');
      if (bar) bar.classList.add('hidden');
      joinChatRoom();
      stopPollingFallback();
      loadMessages().catch(() => {});
      scheduleChatInfoRefresh();
    };
    const onReconnectError = () => {
      const text = document.getElementById('connection-bar-text');
      if (text) text.textContent = 'Connection lost. Retrying...';
    };
    const onRoomJoined = () => {};

    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    socket.on('reconnect_error', onReconnectError);
    // Store references for cleanup on next initializeChat call
    window.__chatSocketHandlers = { onDisconnect, onConnect, onReconnectError, onRoomJoined };

    // Start polling initially only if socket is not already connected
    if (socket.connected) {
      joinChatRoom();
      stopPollingFallback();
    } else {
      startPollingFallback();
    }

    // Listen for tab/visibility state changes to pause/resume fallback polling.
    if (!window.__chatDomListeners) window.__chatDomListeners = {};
    if (window.__chatDomListeners.visibility) {
      document.removeEventListener('visibilitychange', window.__chatDomListeners.visibility);
    }
    const visibilityHandler = function() {
      if (document.hidden) {
        stopPollingFallback();
      } else {
        resetIdleTimer();
        if (!socket || !socket.connected) {
          startPollingFallback();
        }
        // Restart SSE if it was disconnected while hidden
        initRealtimeStream();
        scheduleChatInfoRefresh();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    window.__chatDomListeners.visibility = visibilityHandler;
  } else {
    // No socket at all — run polling fallback
    startPollingFallback();
  }

  // Scroll to bottom button — with duplicate listener cleanup
  const messagesContainer = document.getElementById('chat-messages');
  const scrollBottomBtn = document.getElementById('btn-scroll-bottom');
  
  if (messagesContainer && scrollBottomBtn) {
    // Remove previously registered scroll handler to prevent duplicates
    if (window.__chatDomListeners) {
      const oldScroll = window.__chatDomListeners.scroll;
      if (oldScroll) messagesContainer.removeEventListener('scroll', oldScroll);
    }
    
    const scrollHandler = function() {
      const isNearBottom = isViewingLatestMessages();
      if (isNearBottom) {
        unreadIncomingCount = 0;
        updateNewMessagesButton();
        scrollBottomBtn.classList.add('opacity-0', 'pointer-events-none');
        scrollBottomBtn.classList.remove('opacity-100', 'pointer-events-auto');
        markMessagesAsRead();
      } else {
        scrollBottomBtn.classList.remove('opacity-0', 'pointer-events-none');
        scrollBottomBtn.classList.add('opacity-100', 'pointer-events-auto');
      }
    };
    messagesContainer.addEventListener('scroll', scrollHandler);
    if (!window.__chatDomListeners) window.__chatDomListeners = {};
    window.__chatDomListeners.scroll = scrollHandler;
    
    scrollBottomBtn.onclick = function() {
      scrollToBottom(true);
      unreadIncomingCount = 0;
      updateNewMessagesButton();
      setTimeout(markMessagesAsRead, 150);
    };
  }
  
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('btn-chat-send');
  let typingTimeout = null;

  if (!chatForm || !chatInput || !chatSendBtn) {
    console.error('Chat composer elements are missing; message composer cannot initialize.');
    return;
  }

  // Text input changed (show/hide mic or send buttons + notify typing)
  // Auto-grow textarea handler
  const resizeChatInput = () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  };

  const draftKey = `delulu_chat_draft_${currentConnId}`;
  const savedDraft = localStorage.getItem(draftKey);
  if (savedDraft) {
    chatInput.value = savedDraft;
    resizeChatInput();
  }

  chatInput.oninput = () => {
    resizeChatInput();
    localStorage.setItem(draftKey, chatInput.value);
    notifyTypingState(true);
    if (typingThrottleTimer) clearTimeout(typingThrottleTimer);
    typingThrottleTimer = setTimeout(() => {
      notifyTypingState(false);
    }, 2500);
  };

  // Enter sends, Shift+Enter inserts a newline
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatInput.value.trim()) {
        chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }
  });

  chatInput.onblur = () => {
    notifyTypingState(false);
  };

  let isSending = false; // double-send guard

  chatForm.onsubmit = async (e) => {
    e.preventDefault();
    if (isSending) return; // prevent rapid double-tap duplicate
    const content = chatInput.value.trim();
    if (!content) return;
    isSending = true;
    
    notifyTypingState(false);
    const tempId = 'temp-' + Date.now();
    const clientUuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Clear input & buttons instantly
    chatInput.value = '';
    localStorage.removeItem(draftKey);
    chatInput.style.height = 'auto'; // Reset textarea auto-grow height

    // Append message to UI instantly (Optimistic UI)
    appendMessage({
      tempId,
      is_sending: true,
      sender_id: currentUser.id,
      content,
      client_uuid: clientUuid,
      is_encrypted: 0,
      created_at: new Date().toISOString()
    }, true);

    if (socket && !socket.isMock) {
      socket.emit('typing', { connectionId: currentConnId, isTyping: false });
    }

    // Process encryption & API request in the background
    (async () => {
      let payload = { connection_id: currentConnId, content, client_uuid: clientUuid };
      try {
        if (isE2EEActive && sharedSecretKey) {
          const encrypted = await E2EECrypto.encryptMessage(content, sharedSecretKey);
          payload.content = encrypted.ciphertext;
          payload.is_encrypted = 1;
          payload.iv = encrypted.iv;
        }

        // Attempt to send. If API fails, queue for later (no unreliable navigator.onLine check).
        // The try-catch below handles both network errors and API errors gracefully.
        const result = await apiCall('/api/messages/send', 'POST', payload);
        
        // Remove sending state on success and set actual message ID on the element
        const msgEl = document.getElementById(tempId);
        if (msgEl) {
          msgEl.classList.remove('opacity-60');
          if (result && result.message && result.message.id) {
            msgEl.setAttribute('data-msg-id', result.message.id);
            if (result.message.created_at) {
              lastMessageTimestamp = result.message.created_at;
            }
            if (typeof messageCache !== 'undefined') {
              messageCache.cacheSingleMessage(currentConnId, result.message).catch(() => {});
            }
            
            // Update status icon to single checkmark
            const statusIcon = msgEl.querySelector('.msg-status-icon');
            if (statusIcon) {
              statusIcon.innerHTML = '<span class="text-[11px] opacity-70 material-symbols-outlined text-[14px] align-middle">check</span>';
            }
          }
          msgEl.removeAttribute('id');
        }
      } catch (err) {
        console.error('Failed to send message:', err);
        // If it's a network error (fetch failed), try queuing instead
        if (typeof outboxQueue !== 'undefined') {
          try {
            await outboxQueue.enqueue({
              connection_id: currentConnId,
              content: payload.content,
              is_encrypted: payload.is_encrypted || 0,
              iv: payload.iv || null,
              client_uuid: clientUuid
            });
            const msgEl = document.getElementById(tempId);
            if (msgEl) {
              msgEl.classList.remove('opacity-60');
              msgEl.removeAttribute('id');
              msgEl.dataset.clientUuid = clientUuid;
              const timeEl = msgEl.querySelector('.text-\\[10px\\]');
              if (timeEl) {
                timeEl.textContent = 'Queued — will send when connected';
                timeEl.className = 'text-[10px] mt-1 text-right text-on-surface-variant/70';
              }
            }
            return;
          } catch (e) {}
        }
        
        const msgEl = document.getElementById(tempId);
        if (msgEl) {
          msgEl.classList.remove('opacity-60');
          const innerEl = msgEl.querySelector('div');
          if (innerEl) {
            innerEl.classList.remove('bg-primary');
            innerEl.classList.add('bg-error/10', 'border', 'border-error/30', 'text-error');
          }
          const timeEl = msgEl.querySelector('.text-\\[10px\\]');
          if (timeEl) {
            timeEl.className = 'text-[10px] mt-1 text-right text-error font-bold flex items-center justify-end gap-0.5';
            timeEl.innerHTML = '<span class="material-symbols-outlined text-[12px]">error</span> Failed';
          }
        }
      } finally {
        isSending = false; // always unlock for next message
      }
    })();
  };
  

  
  // Wire up header buttons
  const btnIcebreaker = document.getElementById('btn-icebreaker');
  if (btnIcebreaker) btnIcebreaker.onclick = () => openIcebreakerModal();

  const btnChatMore = document.getElementById('btn-chat-more');
  if (btnChatMore) btnChatMore.onclick = () => openModal('modal-chat-more');

  const btnIdentityReveal = document.getElementById('btn-identity-reveal');
  if (btnIdentityReveal) btnIdentityReveal.onclick = () => openModal('modal-identity-reveal');
  
  const btnFaceReveal = document.getElementById('btn-face-reveal');
  if (btnFaceReveal) btnFaceReveal.onclick = () => openModal('modal-face-reveal');
  
  const identityRevealYes = document.getElementById('identity-reveal-yes');
  if (identityRevealYes) identityRevealYes.onclick = () => submitIdentityRevealAction();

  const identityRevealNo = document.getElementById('identity-reveal-no');
  if (identityRevealNo) identityRevealNo.onclick = () => { closeModal(); };

  const faceRevealYes = document.getElementById('face-reveal-yes');
  if (faceRevealYes) faceRevealYes.onclick = () => submitFaceRevealAction();

  const faceRevealNo = document.getElementById('face-reveal-no');
  if (faceRevealNo) faceRevealNo.onclick = () => submitDeclineFaceReveal();
  
  const faceDeclinedDisconnect = document.getElementById('face-declined-disconnect');
  if (faceDeclinedDisconnect) faceDeclinedDisconnect.onclick = () => disconnectAfterDecline();

  // Profile Peek trigger
  const chatName = document.getElementById('chat-name');
  const chatAvatar = document.getElementById('chat-avatar');
  const openChatProfile = async () => {
    try {
      const data = await apiCall(`/api/connections/${currentConnId}`);
      const c = data.connection;
      const peekName = document.getElementById('peek-name');
      const peekBio = document.getElementById('peek-bio');
      const peekAvatar = document.getElementById('peek-avatar');
      if (peekName) peekName.textContent = c.other_username;
      if (peekBio) peekBio.textContent = c.other_bio || "No bio set.";
      if (peekAvatar) peekAvatar.innerHTML = getAvatarHtml(c.other_username, c.other_avatar);
      openModal('modal-profile-peek');
    } catch(err) { showToast(err.message, 'error'); }
  };
  if (chatName) chatName.onclick = openChatProfile;
  if (chatAvatar) chatAvatar.onclick = openChatProfile;
  // Remove the vibing/not-vibing buttons from profile peek (replaced by header Not Vibing button)
  const peekVibing = document.getElementById('peek-vibing');
  if (peekVibing) peekVibing.remove();

  const peekNotVibing = document.getElementById('peek-not-vibing');
  if (peekNotVibing) peekNotVibing.remove();
  
  // Reconcile queued optimistic bubbles when the offline outbox later reaches
  // the server. A client UUID makes this safe even when an HTTP response was
  // lost after the server had already accepted the message.
  if (!window.__chatOutboxEventsBound) {
    window.__chatOutboxEventsBound = true;
    window.addEventListener('outbox-message-sent', (event) => {
      const { item, message } = event.detail || {};
      if (!item || String(item.connection_id) !== String(currentConnId)) return;
      const row = Array.from(document.querySelectorAll('[data-client-uuid]'))
        .find(el => el.dataset.clientUuid === item.client_uuid);
      if (!row) return;
      row.classList.remove('opacity-60');
      if (message && message.id) row.setAttribute('data-msg-id', message.id);
      const status = row.querySelector('.msg-status-icon');
      if (status) status.innerHTML = '<span class="text-[11px] opacity-70 material-symbols-outlined text-[14px] align-middle">check</span>';
      if (message && typeof messageCache !== 'undefined') {
        messageCache.cacheSingleMessage(currentConnId, message).catch(() => {});
      }
    });
    window.addEventListener('outbox-message-failed', (event) => {
      const item = event.detail;
      if (!item || String(item.connection_id) !== String(currentConnId)) return;
      const row = Array.from(document.querySelectorAll('[data-client-uuid]'))
        .find(el => el.dataset.clientUuid === item.client_uuid);
      if (!row) return;
      const status = row.querySelector('.msg-status-icon');
      if (status) {
        status.innerHTML = '<button type="button" class="text-error font-bold underline" title="Retry sending this message">Retry</button>';
        const retryButton = status.querySelector('button');
        retryButton.onclick = async () => {
          await CHAT_CACHE_DB.pending.update(item.client_uuid, { retry_count: 0, terminal_notified: 0 });
          status.innerHTML = '<span class="text-[11px] opacity-50 material-symbols-outlined text-[14px]">schedule</span>';
          outboxQueue.flushPending().catch(() => {});
        };
      }
    });
  }

  // Start only after the listeners exist so a quick reconnect cannot lose the
  // acknowledgement that reconciles an optimistic bubble.
  if (typeof startOutboxFlush !== 'undefined') {
    startOutboxFlush(15000);
    outboxQueue.flushPending().catch(() => {});
  }

  // Kick off real-time event stream (SSE) for icebreaker games and status changes
  initRealtimeStream();

  // ── Keep-Alive Ping ────────────────────────────────────────────────────────
  // Prevents Render free tier from spinning down during active chat.
  // Render spins down after 15 min of inactivity. A lightweight ping every 3
  // minutes during active chat keeps the server warm so socket.io reconnects
  // instantly instead of waiting for a cold start (5-10s).
  if (!window.__chatKeepAliveStarted) {
    window.__chatKeepAliveStarted = true;
    const sendKeepAlive = () => {
      if (document.hidden || !currentConnId) return;
      apiCall('/api/connections/' + currentConnId)
        .then(() => {}).catch(() => {});
    };
    window.__chatKeepAliveInterval = setInterval(sendKeepAlive, 3 * 60 * 1000); // Every 3 minutes
    // Send one immediately so the server is warm right away
    setTimeout(sendKeepAlive, 5000);
  }
}

// Clean up SSE stream and audio blob URLs when navigating away.
// We only use beforeunload (not visibilitychange) to avoid conflicting with
// the polling/SSE visibility handler in initializeChat(). The SSE stream is
// lightweight and can stay open when the tab is hidden — it doesn't cost
// Firestore reads. Polling is paused via the other handler.
function cleanupChatResources() {
  stopRealtimeStream();
  stopStatusPollingFallback();

  // Clear keep-alive interval so it doesn't keep running after navigation
  if (window.__chatKeepAliveInterval) {
    clearInterval(window.__chatKeepAliveInterval);
    window.__chatKeepAliveInterval = null;
    window.__chatKeepAliveStarted = false;
  }
}

window.addEventListener('beforeunload', cleanupChatResources);

let _readInFlight = false;
let _pendingReadMark = false;

function markMessagesAsRead() {
  // Do not acknowledge an entire thread just because it loaded in the
  // background; advance read state only at the live end of the conversation.
  if (!currentConnId || document.hidden || !hasUnreadMessagesInView || !isViewingLatestMessages()) return;
  if (_readInFlight) {
    _pendingReadMark = true;
    return;
  }
  _readInFlight = true;

  apiCall(`/api/messages/${currentConnId}/read`, 'POST')
    .then((data) => {
      if (data && data.readAt) {
        myLastReadAt = data.readAt;
        hasUnreadMessagesInView = false;
      }
    })
    .catch(() => {})
    .finally(() => {
      _readInFlight = false;
      if (_pendingReadMark) {
        _pendingReadMark = false;
        setTimeout(markMessagesAsRead, 50); // halved from 100ms for snappier read receipts
      }
    });
}

// ===== Scroll to bottom =====
function scrollToBottom(smooth = false) {
  const cont = document.getElementById('chat-messages');
  if (cont) {
    // flex-col-reverse puts the newest message at the scroll origin.
    cont.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    unreadIncomingCount = 0;
    updateNewMessagesButton();
    
    // Attach load listeners to async images so height expansion re-scrolls to bottom
    cont.querySelectorAll('img:not([data-scroll-handled])').forEach(img => {
      img.dataset.scrollHandled = '1';
      if (!img.complete) {
        img.addEventListener('load', () => {
          cont.scrollTo({ top: 0, behavior: 'auto' });
        }, { once: true });
      }
    });
  }
}

if (typeof window !== 'undefined' && window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (isViewingLatestMessages()) scrollToBottom(false);
  });
}

let isPartnerOnline = false;
let otherTypingTimer = null;
let lastTypingStateSent = false;
let typingThrottleTimer = null;
let _typingLeadingEdgeSent = false; // prevents sending typing=true more than once per 2s burst

function handlePresenceChange(isOnline) {
  isPartnerOnline = isOnline;
  updatePresenceDisplay(isOnline);
}

function handleOtherUserTyping(isTyping) {
  const statusEl = document.getElementById('chat-status');
  if (!statusEl) return;

  if (otherTypingTimer) clearTimeout(otherTypingTimer);

  if (isTyping) {
    statusEl.innerHTML = `<span class="flex items-center gap-1 text-primary font-semibold text-xs"><span class="tg-typing-dots"><span class="tg-typing-dot"></span><span class="tg-typing-dot"></span><span class="tg-typing-dot"></span></span>typing</span>`;
    otherTypingTimer = setTimeout(() => {
      updatePresenceDisplay(isPartnerOnline);
    }, 3500);
  } else {
    updatePresenceDisplay(isPartnerOnline);
  }
}

// ===== Presence Display =====
function updatePresenceDisplay(isOnline) {
  const statusEl = document.getElementById('chat-status');
  if (!statusEl) return;
  if (isOnline) {
    statusEl.innerHTML = `<span class="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium"><span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Online</span>`;
  } else {
    statusEl.innerHTML = `<span class="flex items-center gap-1.5 text-on-surface-variant/70"><span class="w-2 h-2 rounded-full bg-outline-variant/60"></span> Offline</span>`;
  }
}

function notifyTypingState(isTyping) {
  if (!currentConnId) return;
  if (lastTypingStateSent === isTyping) return;

  // Leading-edge throttle: send typing=true immediately on first keypress,
  // but suppress any further typing=true signals for 2 seconds to prevent
  // spamming the server with one API call per keystroke.
  if (isTyping) {
    if (_typingLeadingEdgeSent) return; // suppressed — cooldown active
    _typingLeadingEdgeSent = true;
    setTimeout(() => { _typingLeadingEdgeSent = false; }, 2000);
  } else {
    _typingLeadingEdgeSent = false;
  }

  lastTypingStateSent = isTyping;
  apiCall(`/api/connections/${currentConnId}/typing`, 'POST', { isTyping: !!isTyping }).catch(() => {});
}

// ===== Modal Event Delegation (setup outside initializeChat so it works even if init fails) =====
function setupModalEventDelegation() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) return;
  
  overlay.addEventListener('click', async (e) => {
    // Click on overlay background (not on a modal) closes modals
    if (e.target === overlay) {
      closeModal();
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.preventDefault();
    switch (btn.getAttribute('data-action')) {
      case 'close':
        closeModal();
        break;
      case 'icebreaker-from-chat':
        closeModal();
        setTimeout(() => openIcebreakerModal(), 250);
        break;
      case 'end-chat-from-menu':
        closeModal();
        submitNotVibing();
        break;
      case 'report-from-chat':
        closeModal();
        setTimeout(() => openModal('modal-report'), 250);
        break;
      case 'block-from-chat':
        await blockUser();
        closeModal();
        break;
      case 'submit-report':
        submitReport();
        break;
      case 'toggle-theme':
        if (typeof window.toggleTheme === 'function') {
          window.toggleTheme();
        } else {
          document.body.classList.toggle('dark');
          document.documentElement.classList.toggle('dark');
          const isDark = document.body.classList.contains('dark');
          localStorage.setItem('delulu_theme', isDark ? 'dark' : 'light');
        }
        closeModal();
        break;
    }
  });
}

// Setup modal event delegation with DOM-ready safety
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupModalEventDelegation);
} else {
  setupModalEventDelegation();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeChat);
} else {
  initializeChat();
}

// Coalesce multiple calls to loadChatInfo() — only one in-flight at a time.
// Handles the edge case where SSE reconnection, socket connect, and visibilitychange
// all try to refresh chat info simultaneously (saves Supabase reads on the free tier).
function scheduleChatInfoRefresh() {
  if (_chatInfoLoading) {
    // Already loading — queue one retry for after it completes
    _chatInfoQueued = true;
    return;
  }
  _chatInfoQueued = false;
  _chatInfoLoading = true;
  loadChatInfo().finally(() => {
    _chatInfoLoading = false;
    if (_chatInfoQueued) {
      // Another call came in while we were loading — fire one more refresh
      _chatInfoQueued = false;
      _chatInfoLoading = true;
      loadChatInfo().finally(() => { _chatInfoLoading = false; });
    }
  });
}

async function loadChatInfo() {
  try {
    const data = await apiCall(`/api/connections/${currentConnId}`);
    const c = data.connection;
    currentChatOther = c.other_username;
    otherUserId = c.other_user_id;
    otherLastReadAt = c.other_last_read_at || null;
    myLastReadAt = c.my_last_read_at || null;
    
    // E2EE Key Agreement setup
    const privateKeyJwkStr = window.localStorage.getItem('e2ee_private_key');
    if (privateKeyJwkStr && c.other_public_key) {
      try {
        const privateKeyJwk = JSON.parse(privateKeyJwkStr);
        myPrivateKey = await E2EECrypto.importPrivateKeyFromJwk(privateKeyJwk);
        otherPublicKey = await E2EECrypto.importPublicKeyFromJwk(c.other_public_key);
        sharedSecretKey = await E2EECrypto.deriveSharedSecret(myPrivateKey, otherPublicKey);
        isE2EEActive = true;
        console.log('E2EE is active for this chat!');
      } catch (cryptoErr) {
        console.error('Failed to establish E2EE key agreement:', cryptoErr);
      }
    } else {
      console.log('E2EE fallback: Missing keys. Chatting in plain text.');
    }
    
    // Display lock icon next to name if encrypted
    const chatNameEl = document.getElementById('chat-name');
    if (chatNameEl) {
      chatNameEl.innerHTML = `<span class="chat-partner-name">${escapeHtml(c.other_username)} ${isE2EEActive ? '<span class="material-symbols-outlined text-[15px] text-green-600 align-middle ml-1" title="End-to-End Encrypted" style="font-variation-settings: \'FILL\' 1">lock</span>' : ''}</span>`;
    }
    const chatAvatarEl = document.getElementById('chat-avatar');
    if (chatAvatarEl) {
      chatAvatarEl.innerHTML = getAvatarHtml(c.other_username, c.other_avatar);
    }
    
    updateChatStatus(c);
    const isFirstMessageLoad = !hasLoadedInitialMessages;
    await loadMessages(isFirstMessageLoad);
    hasLoadedInitialMessages = true;
    syncActiveGame(c);
    
    // Only the first open owns the viewport. Status/reconnect refreshes must
    // never force someone out of older messages they are reading.
    if (isFirstMessageLoad) scrollToBottom();
    
    // Mark messages as read shortly after loading
    if (isFirstMessageLoad) setTimeout(() => markMessagesAsRead(), 500);
  } catch (err) {
    console.error('loadChatInfo caught error:', err);
    fetch(resolveUrl('/api/log-error'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message: err.message, stack: err.stack, path: window.location.href, context: 'loadChatInfo catch' })
    }).catch(() => {});
    
    const chatNameEl = document.getElementById('chat-name');
    if (chatNameEl) chatNameEl.textContent = 'Chat unavailable';
    const statusEl = document.getElementById('chat-status');
    if (statusEl) statusEl.textContent = err.message || 'Something went wrong loading this chat.';
    const cont = document.getElementById('chat-messages');
    if (cont) {
      cont.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-center p-6 gap-3">
          <p class="text-on-surface-variant text-sm">${escapeHtml(err.message || 'This chat could not be loaded.')}</p>
          <a href="messages.html" class="text-primary font-semibold text-sm hover:underline">← Back to Messages</a>
        </div>`;
    }
    const chatForm = document.getElementById('chat-form');
    if (chatForm) {
      chatForm.querySelectorAll('input, button').forEach(el => el.disabled = true);
    }
  }
}

function updateIdentityRevealModal(c) {
  const countdownDiv = document.getElementById('identity-state-countdown');
  const promptDiv = document.getElementById('identity-state-prompt');
  const waitingDiv = document.getElementById('identity-state-waiting');

  if (!countdownDiv || !promptDiv || !waitingDiv) return;

  // Hide all states
  countdownDiv.classList.add('hidden');
  promptDiv.classList.add('hidden');
  waitingDiv.classList.add('hidden');

  const now = Date.now();
  const chatStarted = c.chat_started_at ? new Date(c.chat_started_at).getTime() : now;
  const identityRevealAt = c.identity_reveal_available_at ? new Date(c.identity_reveal_available_at).getTime() : null;
  const daysSinceChatStarted = Math.floor((now - chatStarted) / (24 * 60 * 60 * 1000));

  // If both already revealed — show meeting modal instead
  if (c.both_identity_revealed) {
    if (c.meeting_code) showMeetingModal(c.meeting_code);
    return;
  }

  // If user already revealed — show waiting state
  if (c.my_identity_reveal === 1) {
    waitingDiv.classList.remove('hidden');
    return;
  }

  // If before Day 7 identity reveal — show countdown with progress
  if (identityRevealAt && now < identityRevealAt) {
    const msRemaining = identityRevealAt - now;
    const totalMs = 7 * 24 * 60 * 60 * 1000;
    const msElapsed = now - chatStarted;
    const progressPct = Math.min(100, Math.max(0, (msElapsed / totalMs) * 100));
    const daysRemaining = Math.floor(msRemaining / (24 * 60 * 60 * 1000));
    const hoursRemaining = Math.floor((msRemaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

    const daysEl = document.getElementById('identity-countdown-days');
    if (daysEl) daysEl.textContent = `${daysRemaining}d ${hoursRemaining}h`;

    // Update progress ring (circumference = 2 * pi * 42 = 263.89)
    const ring = document.getElementById('identity-progress-ring');
    if (ring) {
      const circumference = 263.89;
      const offset = circumference * (1 - progressPct / 100);
      ring.style.strokeDashoffset = offset;
    }

    // Update timeline bar (maxes at 50% since Day 7 is midpoint of the journey)
    const tlProgress = document.getElementById('identity-timeline-progress');
    if (tlProgress) {
      const tlPct = Math.min(50, (progressPct / 100) * 50);
      tlProgress.style.width = `${tlPct}%`;
    }

    // Update the milestone dot
    const milestone = document.getElementById('identity-timeline-milestone');
    if (milestone) {
      if (daysSinceChatStarted >= 1) {
        const dot = milestone.querySelector('div');
        if (dot) {
          dot.className = 'w-6 h-6 rounded-full bg-secondary flex items-center justify-center';
        }
      }
    }

    countdownDiv.classList.remove('hidden');
    return;
  }

  // Day 7 has arrived and user hasn't revealed — show prompt
  if (c.my_identity_reveal === 0) {
    // Update the day count text dynamically
    const dayText = promptDiv.querySelector('p.text-on-surface-variant.text-sm');
    if (dayText) {
      dayText.textContent = `You've been chatting for ${daysSinceChatStarted} days. Ready to show each other who you are?`;
    }
    promptDiv.classList.remove('hidden');
  }
}

function updateChatStatus(c) {
  const statusEl = document.getElementById('chat-status');
  const identityRevealBtn = document.getElementById('btn-identity-reveal');
  const faceRevealBtn = document.getElementById('btn-face-reveal');
  
  if (identityRevealBtn) identityRevealBtn.classList.add('hidden');
  if (faceRevealBtn) faceRevealBtn.classList.add('hidden');
  
  if (c.status === 'accepted' || c.status === 'revealed') {
    const now = Date.now();
    const chatStarted = c.chat_started_at ? new Date(c.chat_started_at).getTime() : now;
    const daysSinceChatStarted = Math.floor((now - chatStarted) / (24 * 60 * 60 * 1000));
    
    const identityRevealAt = c.identity_reveal_available_at ? new Date(c.identity_reveal_available_at).getTime() : null;
    const faceRevealAt = c.face_reveal_available_at ? new Date(c.face_reveal_available_at).getTime() : null;
    const isIdentityRevealDue = identityRevealAt ? now >= identityRevealAt : false;
    const isFaceRevealDue = faceRevealAt ? now >= faceRevealAt : false;
    
    // Both agreed to any reveal — show meeting
    if (c.both_face_revealed || c.both_identity_revealed) {
      if (c.meeting_code && !document.getElementById('modal-google-meet').classList.contains('scale-100')) {
        showMeetingModal(c.meeting_code);
      }
      if (statusEl) {
        statusEl.innerHTML = `<span class="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold"><span class="material-symbols-outlined text-[14px]">videocam</span> Meeting ready! <a href="#" onclick="showMeetingModal('${c.meeting_code}'); return false;" class="underline font-bold">Join</a></span>`;
      }
      return;
    }
    
    // Face reveal (Day 10) takes priority over identity reveal
    if (isFaceRevealDue) {
      if (faceRevealBtn) {
        faceRevealBtn.classList.remove('hidden');
        faceRevealBtn.textContent = c.my_face_reveal === 0 ? "Let's Meet" : 'Waiting...';
        faceRevealBtn.disabled = c.my_face_reveal === 1;
      }
      if (c.my_face_reveal === 0 && c.my_identity_reveal === 0) {
        const faceModal = document.getElementById('modal-face-reveal');
        if (faceModal && !faceModal.classList.contains('scale-100')) {
          openModal(faceModal.id);
        }
      }
      if (statusEl) {
        statusEl.textContent = c.my_face_reveal === 1
          ? 'Waiting for partner to reveal...'
          : `Day ${daysSinceChatStarted} - Face reveal available!`;
      }
      return;
    }
    
    // Identity reveal (Day 7) — show identity reveal modal
    if (isIdentityRevealDue) {
      if (identityRevealBtn) {
        identityRevealBtn.classList.remove('hidden');
        identityRevealBtn.textContent = c.my_identity_reveal === 0 ? "Reveal" : 'Waiting...';
        identityRevealBtn.disabled = c.my_identity_reveal === 1;
      }
      // Auto-show the identity reveal modal (with the right state)
      if (c.my_identity_reveal === 0) {
        updateIdentityRevealModal(c);
        const idModal = document.getElementById('modal-identity-reveal');
        if (idModal && !idModal.classList.contains('scale-100')) {
          openModal('modal-identity-reveal');
        }
      }
      if (statusEl) {
        if (c.my_identity_reveal === 1) {
          statusEl.textContent = 'Waiting for partner to reveal...';
        } else {
          const daysUntilFace = faceRevealAt ? Math.ceil((faceRevealAt - now) / (24 * 60 * 60 * 1000)) : 3;
          statusEl.innerHTML = `<span class="text-on-surface-variant/80">Identity reveal ready! Face reveal in ${daysUntilFace}d</span>`;
        }
      }
      return;
    }
    
    // Before Day 7: Show countdown to identity reveal
    const daysUntilIdentity = identityRevealAt ? Math.ceil((identityRevealAt - now) / (24 * 60 * 60 * 1000)) : 7;
    if (statusEl && !isPartnerOnline) {
      statusEl.innerHTML = `<span class="text-on-surface-variant/80"><span class="material-symbols-outlined text-[12px] align-middle mr-0.5">lock</span> Identity reveal in ${daysUntilIdentity}d</span>`;
    }
  } else if (c.status === 'revealed') {
    // Both already revealed — meeting ready (both_face_revealed or both_identity_revealed handles this above)
    if (statusEl) statusEl.innerHTML = `<span class="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold"><span class="material-symbols-outlined text-[14px]">videocam</span> Meeting ready! <a href="#" onclick="showMeetingModal('${c.meeting_code}'); return false;" class="underline font-bold">Join</a></span>`;
  } else {
    if (statusEl) statusEl.textContent = c.status;
  }
}

function showBadLuckModal(msg) {
  const msgEl = document.getElementById('bad-luck-message');
  if (msgEl) {
    msgEl.textContent = msg || 'Oops! Bad Luck... The other person chose not to reveal or ended the chat. This chat has ended and messages have been cleared.';
  }
  const disconnectBtn = document.getElementById('face-declined-disconnect');
  if (disconnectBtn) {
    disconnectBtn.onclick = () => {
      window.location.href = 'discover.html';
    };
  }
  openModal('modal-face-declined');
}

function showChatSkeleton() {
  const cont = document.getElementById('chat-messages');
  if (!cont) return;
  
  // Generate 6 alternating skeleton chat bubbles (3 from each side)
  cont.innerHTML = '';
  const patterns = [
    { side: 'left', lines: [70, 40] },
    { side: 'right', lines: [55, 85] },
    { side: 'left', lines: [85, 70, 40] },
    { side: 'right', lines: [70] },
    { side: 'left', lines: [55, 85, 55] },
    { side: 'right', lines: [85, 55] },
  ];
  
  patterns.forEach(({ side, lines }) => {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-skeleton-wrapper ${side === 'right' ? 'justify-end' : ''}`;
    
    // Avatar (only shown on left-side messages)
    const avatar = document.createElement('div');
    avatar.className = `chat-skeleton-avatar ${side}`;
    wrapper.appendChild(avatar);
    
    // Bubble
    const bubble = document.createElement('div');
    bubble.className = `chat-skeleton-bubble ${side}`;
    // Apply background color matching message bubble colors
    if (side === 'right') {
      bubble.style.background = 'var(--surface-container-low, #f0eded)';
    } else {
      bubble.style.background = 'var(--surface-container-high, #e4e2e1)';
    }
    
    lines.forEach(width => {
      const line = document.createElement('div');
      line.className = `chat-skeleton-line w-${width}`;
      bubble.appendChild(line);
    });
    
    wrapper.appendChild(bubble);
    cont.appendChild(wrapper);
  });
}

// ── Load Older Messages (Infinite Scroll Upward) ────────────────────────────
// Triggered by the IntersectionObserver when the top sentinel enters the viewport.
// Fetches the next page of older messages using oldestMessageTimestamp as cursor.
async function loadOlderMessages() {
  if (!currentConnId || _loadingOlderMessages || !hasMoreMessages) return;
  _loadingOlderMessages = true;

  const cont = document.getElementById('chat-messages');
  if (!cont) { _loadingOlderMessages = false; return; }

  // Show a subtle loading indicator at the top
  const loader = document.createElement('div');
  loader.id = 'older-msgs-loader';
  loader.className = 'flex justify-center items-center py-3 gap-2 text-on-surface-variant text-xs font-medium fade-in';
  loader.innerHTML = '<span class="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin"></span> Loading older messages...';
  cont.appendChild(loader); // append = top of flex-col-reverse = visual top

  try {
    // 1. Try to serve from IndexedDB cache first (zero network cost)
    if (oldestMessageTimestamp && typeof messageCache !== 'undefined') {
      const cachedOlder = await messageCache.getCachedOlderMessages(
        currentConnId, oldestMessageTimestamp, 30
      );

      if (cachedOlder.length > 0) {
        // Capture scroll position before inserting to prevent jump
        const prevScrollHeight = cont.scrollHeight;

        // Update oldest cursor
        oldestMessageTimestamp = cachedOlder[0].created_at;

        // Prepend older messages (they are oldest-first, so append in flex-col-reverse = visual top)
        const tempLastDate = lastMessageDate;
        const tempLastSender = lastSenderId;
        lastMessageDate = null;
        lastSenderId = null;

        for (const m of cachedOlder) {
          await appendMessageAtTop(m);
        }

        // Restore rendering state for future messages
        lastMessageDate = tempLastDate;
        lastSenderId = tempLastSender;

        // Maintain scroll position — user should not feel any jump
        const newScrollHeight = cont.scrollHeight;
        cont.scrollTop = cont.scrollTop + (newScrollHeight - prevScrollHeight);

        // Check if the cache has even older messages
        const cachedCount = await messageCache.getTotalCachedCount(currentConnId);
        const oldestCached = await messageCache.getOldestMessageTime(currentConnId);
        // If the oldest we displayed equals the oldest in cache, we may need to hit network
        if (oldestCached && oldestMessageTimestamp <= oldestCached) {
          // Cache is exhausted — check network for older data
          hasMoreMessages = true; // let next scroll attempt hit network
        }

        loader.remove();
        _loadingOlderMessages = false;
        return;
      }
    }

    // 2. Cache miss — fetch from server
    const params = new URLSearchParams({ limit: '30' });
    if (oldestMessageTimestamp) params.set('before', oldestMessageTimestamp);

    const data = await apiCall(`/api/messages/${currentConnId}?${params}`);
    const older = data.messages || [];
    hasMoreMessages = data.has_more || false;

    if (older.length > 0) {
      // Cache these messages for future offline access
      if (typeof messageCache !== 'undefined') {
        messageCache.cacheMessages(currentConnId, older).catch(() => {});
      }

      const prevScrollHeight = cont.scrollHeight;
      oldestMessageTimestamp = older[0].created_at;

      // Temporarily reset date/sender tracking so headers render correctly for this older page
      const savedDate = lastMessageDate;
      const savedSender = lastSenderId;
      lastMessageDate = null;
      lastSenderId = null;

      for (const m of older) {
        await appendMessageAtTop(m);
      }

      lastMessageDate = savedDate;
      lastSenderId = savedSender;

      // Restore scroll to prevent jump
      const newScrollHeight = cont.scrollHeight;
      cont.scrollTop = cont.scrollTop + (newScrollHeight - prevScrollHeight);
    }

    if (!hasMoreMessages) {
      // Show "beginning of conversation" pill
      const endPill = document.createElement('div');
      endPill.className = 'flex justify-center my-4 fade-in';
      endPill.innerHTML = '<span class="px-4 py-1.5 rounded-full bg-surface-variant/60 text-on-surface-variant text-[11px] font-semibold backdrop-blur-sm">Beginning of conversation</span>';
      cont.appendChild(endPill);
    }
  } catch (err) {
    console.warn('loadOlderMessages error:', err);
  } finally {
    loader.remove();
    _loadingOlderMessages = false;
  }
}

/**
 * Like appendMessage() but inserts at the visual TOP (bottom of DOM in flex-col-reverse).
 * Used exclusively by loadOlderMessages() for historical pages.
 */
async function appendMessageAtTop(m) {
  const cont = document.getElementById('chat-messages');
  if (!cont || !m) return;
  // Skip if already in the DOM
  if (m.id && document.querySelector(`[data-msg-id="${m.id}"]`)) return;
  // Temporarily swap prepend → append so message goes to visual top
  const _origPrepend = cont.prepend.bind(cont);
  cont.prepend = (...args) => cont.append(...args);
  // Also mark that we're in top-append mode so grouping is skipped
  cont._appendingAtTop = true;
  try {
    await appendMessage(m, false);
  } finally {
    cont.prepend = _origPrepend;
    cont._appendingAtTop = false;
  }
}

/**
 * Wire up the IntersectionObserver on the top sentinel div so loadOlderMessages()
 * fires automatically when the user scrolls to the top of the chat.
 */
function initTopSentinelObserver() {
  if (_topSentinelObserver) {
    _topSentinelObserver.disconnect();
    _topSentinelObserver = null;
  }

  const cont = document.getElementById('chat-messages');
  if (!cont) return;

  // Create or find the sentinel
  let sentinel = document.getElementById('chat-top-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'chat-top-sentinel';
    sentinel.className = 'h-1 w-full flex-shrink-0';
    sentinel.setAttribute('aria-hidden', 'true');
    cont.appendChild(sentinel); // append = visual top in flex-col-reverse
  }

  _topSentinelObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && hasMoreMessages && !_loadingOlderMessages) {
        loadOlderMessages();
      }
    },
    {
      root: cont,
      rootMargin: '200px 0px 0px 0px', // trigger 200px before user actually hits the top
      threshold: 0
    }
  );

  _topSentinelObserver.observe(sentinel);
}

async function loadMessages(isInitial = false, forceFull = false) {
  const cont = document.getElementById('chat-messages');
  if (!cont) return;
  // Capture this before DOM mutations: it decides whether a refresh may follow
  // the newest message or must preserve the reader's history position.
  const shouldFollowLatest = isInitial || isViewingLatestMessages();
  let hasCachedMessages = false;
  try {
    // 1. Render from IndexedDB cache instantly on initial load (no network wait)
    if (isInitial && typeof messageCache !== 'undefined') {
      const cached = await messageCache.getCachedMessages(currentConnId);
      if (cached.length > 0) {
        hasCachedMessages = true;
        // Restore lastMessageTimestamp from cache so the network fetch uses delta sync
        const cacheLastTimestamp = await messageCache.getLastMessageTime(currentConnId);
        if (cacheLastTimestamp && (!lastMessageTimestamp || cacheLastTimestamp > lastMessageTimestamp)) {
          lastMessageTimestamp = cacheLastTimestamp;
        }
        // Preserve game elements (icebreaker cards) when clearing
        // Use a specific data attribute selector to avoid matching non-game elements by accident
        const existingGames = cont.querySelectorAll('[id^="game-"]');
        cont.innerHTML = '';
        lastMessageDate = null;
        lastSenderId = null;
        for (const m of cached) {
          if (isUnreadFromOther(m)) {
            hasUnreadMessagesInView = true;
            hasReadMessagesInView = false;
          }
          await appendMessage(m, false);
        }
        // Re-prepend game elements so they appear at the bottom (flex-col-reverse)
        existingGames.forEach(el => cont.prepend(el));
        if (shouldFollowLatest) scrollToBottom();
      }
    }
    
    // Only show skeleton on initial load if no cache is present
    if (isInitial && !hasCachedMessages) {
      showChatSkeleton();
    }
    
    // 2. Fetch from server. Initial opens refresh the latest window fully so
    // cached reactions/deletes cannot stay stale; active polling remains delta-based.
    const since = (isInitial || forceFull) ? null : getDeltaSinceParam(lastMessageTimestamp);
    const data = await apiCall(`/api/messages/${currentConnId}${since ? '?since=' + encodeURIComponent(since) : ''}`);
    
    // Clear skeletons if we loaded the initial set from network
    if (isInitial && !hasCachedMessages) {
      cont.innerHTML = '';
    }

    // Update pagination state from server response
    if (isInitial || forceFull) {
      hasMoreMessages = data.has_more || false;
    }
    
    if (data.messages && data.messages.length > 0) {
      const existingIds = new Set();
      cont.querySelectorAll('[data-msg-id]').forEach(el => {
        existingIds.add(el.getAttribute('data-msg-id'));
      });

      data.messages.forEach(m => {
        if (existingIds.has(String(m.id))) {
          refreshExistingMessage(m);
        }
      });
      
      const newMsgs = data.messages.filter(m => !existingIds.has(String(m.id)));
      if (newMsgs.length > 0) {
        const incoming = newMsgs.filter(m => Number(m.sender_id) !== Number(currentUser.id));
        if (!shouldFollowLatest) incoming.forEach(recordIncomingMessage);
        for (const m of newMsgs) {
          if (isUnreadFromOther(m)) {
            hasUnreadMessagesInView = true;
            hasReadMessagesInView = false;
          }
          await appendMessage(m, false);
        }
        if (shouldFollowLatest) scrollToBottom();
      }

      // Track the oldest message timestamp for the load-more cursor
      if ((isInitial || forceFull) && data.messages.length > 0) {
        const oldest = data.messages[0].created_at;
        if (!oldestMessageTimestamp || oldest < oldestMessageTimestamp) {
          oldestMessageTimestamp = oldest;
        }
      }
      
      // Cache all messages for next instant render
      if (typeof messageCache !== 'undefined') {
        messageCache.cacheMessages(currentConnId, data.messages).catch(() => {});
      }
    }
    
    // Mark as read after loading
    if (shouldFollowLatest) setTimeout(() => markMessagesAsRead(), 300);

    // Initialise the top sentinel observer after the first successful load
    if (isInitial) {
      initTopSentinelObserver();
    }
  } catch (err) {
    console.error('loadMessages caught error:', err);
    if (!hasCachedMessages) {
      await fetch(resolveUrl('/api/log-error'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: err.message, stack: err.stack, path: window.location.href, context: 'loadMessages catch' })
      }).catch(() => {});
      cont.innerHTML = `<p class="text-error">${escapeHtml(err.message)}</p>`;
    }
  }
}

function renderReactions(m, parentContainer) {
  if (!parentContainer) return;
  // Remove existing reactions container if any
  const existing = parentContainer.querySelector('.reactions-container');
  if (existing) existing.remove();

  const reactions = m.reactions || {};
  const emojis = Object.keys(reactions);
  if (emojis.length === 0) return;

  const container = document.createElement('div');
  container.className = 'reactions-container flex flex-wrap gap-1 mt-1.5';
  emojis.forEach(emoji => {
    const userIds = reactions[emoji] || [];
    if (userIds.length === 0) return;
    const hasReacted = userIds.some(id => Number(id) === Number(currentUser.id));
    
    const pill = document.createElement('div');
    pill.className = `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
      hasReacted 
        ? 'bg-primary-container/20 text-primary border-primary/30' 
        : 'bg-surface-container-low text-on-surface-variant border-outline-variant/30 hover:bg-surface-container-high'
    }`;
    pill.innerHTML = `<span>${escapeHtml(emoji)}</span><span class="text-[10px] opacity-80">${userIds.length}</span>`;
    
    pill.onclick = async (e) => {
      e.stopPropagation();
      // Optimistic UI update: toggle current user ID locally for zero-latency feedback
      const backupReactions = JSON.parse(JSON.stringify(m.reactions || {}));
      if (!m.reactions) m.reactions = {};
      if (!m.reactions[emoji]) m.reactions[emoji] = [];
      const myId = Number(currentUser.id);
      const userIdx = m.reactions[emoji].indexOf(myId);
      if (userIdx > -1) {
        m.reactions[emoji].splice(userIdx, 1);
        if (m.reactions[emoji].length === 0) delete m.reactions[emoji];
      } else {
        m.reactions[emoji].push(myId);
      }
      renderReactions(m, parentContainer);

      try {
        const result = await apiCall(`/api/messages/${m.id}/react`, 'POST', { connection_id: currentConnId, emoji });
        if (result && result.reactions) {
          m.reactions = result.reactions;
          renderReactions(m, parentContainer);
        }
      } catch (err) {
        // Rollback on server failure
        m.reactions = backupReactions;
        renderReactions(m, parentContainer);
        showToast(`Failed to update reaction: ${err.message}`, 'error');
      }
    };
    container.appendChild(pill);
  });
  parentContainer.appendChild(container);
}

function refreshExistingMessage(m) {
  if (!m || !m.id) return false;
  const el = document.querySelector(`[data-msg-id="${m.id}"]`);
  if (!el) return false;
  const inner = el.querySelector('.msg-bubble') || el.querySelector('.rounded-2xl');
  if (!inner) return true;

  if (m.deleted_at) {
    inner.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'text-[15px] italic opacity-70 break-words';
    p.textContent = 'This message was deleted';
    inner.appendChild(p);

    const timeEl = document.createElement('div');
    const isMe = Number(m.sender_id) === Number(currentUser.id);
    timeEl.className = `msg-meta text-[10px] mt-1`;
    timeEl.textContent = formatTime(m.created_at);
    inner.appendChild(timeEl);

    const btn = el.querySelector('.more-actions-btn');
    if (btn) btn.remove();
    return true;
  }

  renderReactions(m, inner);
  return true;
}

function showMessageMenu(e, msg, bubbleEl) {
  const btn = e.currentTarget;
  const existing = document.getElementById('message-action-menu');
  if (existing) existing.remove();

  const isMe = Number(msg.sender_id) === Number(currentUser.id);
  const menu = document.createElement('div');
  menu.id = 'message-action-menu';
  menu.className = 'fixed bg-surface shadow-xl rounded-2xl p-2 border border-outline-variant/30 z-50 flex flex-col gap-2 scale-95 opacity-0 transition-all duration-150 ease-out';
  
  const rect = btn.getBoundingClientRect();
  const menuHeight = isMe ? 95 : 50;
  const menuWidth = 190;
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;

  // If button is near bottom of viewport, position menu ABOVE the button so it doesn't get cut off by input bar
  const spaceBelow = viewportH - rect.bottom - 75;
  if (spaceBelow < menuHeight && rect.top > menuHeight + 10) {
    menu.style.top = `${Math.max(10, rect.top - menuHeight - 6)}px`;
  } else {
    menu.style.top = `${Math.min(viewportH - menuHeight - 80, rect.bottom + 6)}px`;
  }

  // Ensure horizontal bounds keep popover on-screen with safe margin
  if (isMe) {
    const rightMargin = Math.max(12, Math.min(viewportW - rect.right, viewportW - menuWidth - 12));
    menu.style.right = `${rightMargin}px`;
  } else {
    const leftMargin = Math.max(12, Math.min(rect.left, viewportW - menuWidth - 12));
    menu.style.left = `${leftMargin}px`;
  }

  const emojiRow = document.createElement('div');
  emojiRow.className = 'flex gap-1 border-b border-outline-variant/20 pb-2 px-1';
  const emojis = ['😂', '😢', '❤️', '👍', '😮'];
  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'text-lg hover:scale-125 transition-transform p-1 cursor-pointer';
    btn.textContent = emoji;
    btn.onclick = async () => {
      menu.remove();
      // Optimistic reaction toggle
      const backupReactions = JSON.parse(JSON.stringify(msg.reactions || {}));
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      const myId = Number(currentUser.id);
      const userIdx = msg.reactions[emoji].indexOf(myId);
      if (userIdx > -1) {
        msg.reactions[emoji].splice(userIdx, 1);
        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
      } else {
        msg.reactions[emoji].push(myId);
      }
      renderReactions(msg, bubbleEl);

      try {
        const result = await apiCall(`/api/messages/${msg.id}/react`, 'POST', { connection_id: currentConnId, emoji });
        if (result && result.reactions) {
          msg.reactions = result.reactions;
          renderReactions(msg, bubbleEl);
        }
      } catch (err) {
        msg.reactions = backupReactions;
        renderReactions(msg, bubbleEl);
        showToast(`Failed to update reaction: ${err.message}`, 'error');
      }
    };
    emojiRow.appendChild(btn);
  });
  menu.appendChild(emojiRow);

  if (Number(msg.sender_id) === Number(currentUser.id)) {
    const delBtn = document.createElement('button');
    delBtn.className = 'w-full text-left px-3 py-1.5 text-error text-xs font-bold hover:bg-error/10 rounded-lg transition-colors flex items-center gap-2 cursor-pointer';
    delBtn.innerHTML = '<span class="material-symbols-outlined text-sm">delete</span> Delete Message';
    delBtn.onclick = async () => {
      if (confirm('Are you sure you want to delete this message? This cannot be undone.')) {
        menu.remove();
        // Optimistic UI update: immediately show deleted state
        const backupHTML = bubbleEl.innerHTML;
        bubbleEl.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'text-[15px] italic opacity-70 break-words';
        p.textContent = 'This message was deleted';
        bubbleEl.appendChild(p);
        const timeEl = document.createElement('div');
        timeEl.className = 'msg-meta text-[10px] mt-1';
        timeEl.textContent = 'deleted';
        bubbleEl.appendChild(timeEl);

        const wrapper = bubbleEl.closest('[data-msg-id]');
        const moreBtn = wrapper ? wrapper.querySelector('.more-actions-btn') : null;
        if (moreBtn) moreBtn.remove();

        try {
          await apiCall(`/api/messages/${msg.id}`, 'DELETE', { connection_id: currentConnId });
          msg.deleted_at = new Date().toISOString();
        } catch (err) {
          // Graceful Rollback on server failure
          bubbleEl.innerHTML = backupHTML;
          showToast(`Failed to delete message: ${err.message}`, 'error');
        }
      }
    };
    menu.appendChild(delBtn);
  }

  document.body.appendChild(menu);
  
  setTimeout(() => {
    menu.classList.remove('scale-95', 'opacity-0');
    menu.classList.add('scale-100', 'opacity-100');
  }, 10);

  const closeHandler = (event) => {
    if (!menu.contains(event.target) && !btn.contains(event.target)) {
      menu.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 50);
}

let lastMessageDate = null;
let lastSenderId = null;

async function appendMessage(m, scrollToBottom = true) {
  const cont = document.getElementById('chat-messages');
  if (!cont || !m) return;
  if (m.id) {
    const existing = document.querySelector(`[data-msg-id="${m.id}"]`);
    if (existing) {
      refreshExistingMessage(m);
      return;
    }
  }
  const isMe = Number(m.sender_id) === Number(currentUser.id);
  const time = formatTime(m.created_at);
  
  // Add date divider if date changed
  if (m.created_at) {
    if (m.id && !m.is_sending && (!lastMessageTimestamp || new Date(m.created_at) > new Date(lastMessageTimestamp))) {
      lastMessageTimestamp = m.created_at;
    }
    const msgDate = new Date(m.created_at).toDateString();
    if (msgDate !== lastMessageDate) {
      lastMessageDate = msgDate;
      const divider = createDateDivider(m.created_at);
      cont.prepend(divider);
    }
  }
  
  const isSenderChange = lastSenderId !== null && Number(lastSenderId) !== Number(m.sender_id);
  lastSenderId = m.sender_id;

  // ── Telegram-style grouping ───────────────────────────────────────────────
  // Find the most recently rendered message (DOM first child = visual bottom in flex-col-reverse)
  // If it's from the same sender, update its bubble to remove the tail (it's now middle of group)
  // and tighten the spacing on the new message.
  const _prevMsgEl = (() => {
    for (const child of cont.children) {
      if (child.dataset && child.dataset.senderId !== undefined) return child;
    }
    return null;
  })();
  const _prevSenderId = _prevMsgEl?.dataset?.senderId;
  const _isGrouped = !isSenderChange && _prevSenderId !== undefined && !m.is_sending;

  if (_isGrouped && _prevMsgEl) {
    const prevBubble = _prevMsgEl.querySelector('.msg-bubble');
    if (prevBubble) {
      prevBubble.classList.remove('msg-tail');
      prevBubble.classList.add('msg-no-tail');
    }
  }

  const div = document.createElement('div');
  const _rowSpacing = _isGrouped
    ? 'msg-row-grouped'
    : (isSenderChange ? 'msg-row-new-sender' : 'mt-3.5');
  div.className = `flex group items-end gap-2 ${isMe ? 'justify-end pl-10' : 'justify-start pr-10'} w-full fade-in ${_rowSpacing}`;
  if (m.id)    div.setAttribute('data-msg-id', m.id);
  if (m.tempId) div.id = m.tempId;
  if (m.client_uuid) div.dataset.clientUuid = m.client_uuid;
  if (m.is_sending) div.classList.add('opacity-60');
  div.dataset.senderId = String(m.sender_id);

  const inner = document.createElement('div');
  inner.className = `msg-bubble ${isMe ? 'msg-bubble-sent' : 'msg-bubble-received'} msg-tail min-w-0 relative`;
  
  if (m.deleted_at !== null && m.deleted_at !== undefined) {
    const p = document.createElement('p');
    p.className = 'text-[15px] italic opacity-70 break-words';
    p.textContent = 'This message was deleted';
    inner.appendChild(p);
    
    const timeEl = document.createElement('div');
    timeEl.className = 'msg-meta text-[10px] mt-1';
    timeEl.textContent = time;
    inner.appendChild(timeEl);
    
    div.appendChild(inner);
    cont.prepend(div);
    if (scrollToBottom) cont.scrollTop = 0;
    return;
  }

  // Decrypt content if it is E2EE encrypted
  const isEncrypted = Number(m.is_encrypted) === 1;
  let displayContent = m.content || '';
  
  if (isEncrypted && displayContent && !displayContent.startsWith('/uploads/')) {
    if (isE2EEActive && sharedSecretKey && m.iv) {
      try {
        displayContent = await E2EECrypto.decryptMessage(displayContent, m.iv, sharedSecretKey);
      } catch (decErr) {
        console.error('Decryption failed:', decErr);
        displayContent = '[Unable to decrypt message on this device]';
      }
    } else {
      displayContent = '[Encrypted message]';
    }
  }

  // Handle voice messages (rendered as plain text since voice upload was removed)
  if (Number(m.is_voice) === 1 || (displayContent && displayContent.startsWith('/uploads/voice/'))) {
    const p = document.createElement('p');
    p.className = 'text-[15px] italic leading-relaxed break-words [overflow-wrap:anywhere] [word-break:break-word] whitespace-pre-wrap';
    p.textContent = displayContent.startsWith('/uploads/') ? 'Voice note' : displayContent;
    inner.appendChild(p);
  } else {
    const p = document.createElement('p');
    p.className = 'text-[15px] leading-relaxed break-words [overflow-wrap:anywhere] [word-break:break-word] whitespace-pre-wrap';
    p.textContent = displayContent;
    if (isEncrypted) {
      p.innerHTML += ` <span class="material-symbols-outlined text-[12px] text-green-600 self-center" title="End-to-End Encrypted">lock</span>`;
    }
    inner.appendChild(p);
  }
  
  // Time + Status row
  const metaRow = document.createElement('div');
  metaRow.className = 'msg-meta text-[10px] mt-1';
  
  const timeSpan = document.createElement('span');
  timeSpan.textContent = time;
  metaRow.appendChild(timeSpan);
  
  // Message status icon (for own messages)
  // Use deleted_at instead of the old field name 'deleted' which no longer exists
  if (isMe && !m.is_sending && !m.deleted_at) {
    const statusSpan = document.createElement('span');
    statusSpan.className = 'msg-status-icon inline-flex items-center';
    const read = isMessageRead(m);
    statusSpan.innerHTML = read 
      ? '<span class="text-[11px] text-blue-500 material-symbols-outlined text-[14px] align-middle" style="font-variation-settings: \'FILL\' 1">done_all</span>'
      : '<span class="text-[11px] opacity-70 material-symbols-outlined text-[14px] align-middle">check</span>';
    metaRow.appendChild(statusSpan);
  } else if (m.is_sending) {
    const statusSpan = document.createElement('span');
    statusSpan.className = 'msg-status-icon inline-flex items-center';
    statusSpan.innerHTML = '<span class="text-[11px] opacity-50 material-symbols-outlined text-[14px]">schedule</span>';
    metaRow.appendChild(statusSpan);
  }
  
  inner.appendChild(metaRow);
  
  renderReactions(m, inner);
  
  const actionsBtn = document.createElement('button');
  actionsBtn.className = 'more-actions-btn p-1 hover:bg-surface-container rounded-full text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center shrink-0 self-end mb-1';
  actionsBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">more_vert</span>';
  actionsBtn.onclick = (e) => {
    e.stopPropagation();
    const currentId = div.getAttribute('data-msg-id');
    if (!currentId) {
      showToast('Please wait for the message to finish sending.');
      return;
    }
    const currentMsg = { ...m, id: Number(currentId) };
    showMessageMenu(e, currentMsg, inner);
  };

  if (isMe) {
    div.appendChild(actionsBtn);
    div.appendChild(inner);
  } else {
    div.appendChild(inner);
    div.appendChild(actionsBtn);
  }
  
  cont.prepend(div);
  
  if (scrollToBottom) {
    cont.scrollTo({ top: 0, behavior: 'auto' });
  }
  
  // Write to IndexedDB cache after rendering
  if (m.id && typeof messageCache !== 'undefined') {
    messageCache.cacheSingleMessage(currentConnId, m).catch(() => {});
  }
}



window.openModal = function(id) {
  // Cancel any pending close animation to prevent race condition
  if (closeModalTimeout) {
    clearTimeout(closeModalTimeout);
    closeModalTimeout = null;
  }
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
  }
  const m = document.getElementById(id);
  if (m) {
    m.classList.remove('hidden');
    setTimeout(() => {
      m.classList.remove('scale-95');
      m.classList.add('scale-100');
    }, 10);
  }
};

function setAllModalsHidden(hidden) {
  ['modal-identity-reveal', 'modal-face-reveal', 'modal-face-declined', 'modal-google-meet', 'modal-end-chat', 'modal-profile-peek', 'modal-icebreaker', 'modal-report', 'modal-chat-more'].forEach(id => {
    const m = document.getElementById(id);
    if (m) {
      if (hidden) {
        m.classList.add('hidden');
      } else {
        m.classList.remove('hidden');
      }
    }
  });
}

window.closeModal = function() {
  // Cancel any pending close animation
  if (closeModalTimeout) {
    clearTimeout(closeModalTimeout);
    closeModalTimeout = null;
  }
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }
  ['modal-identity-reveal', 'modal-face-reveal', 'modal-face-declined', 'modal-google-meet', 'modal-end-chat', 'modal-profile-peek', 'modal-icebreaker', 'modal-report', 'modal-chat-more'].forEach(id => {
    const m = document.getElementById(id);
    if (m) {
      m.classList.remove('scale-100');
      m.classList.add('scale-95');
    }
  });
  // Hide modals after short animation completes
  closeModalTimeout = setTimeout(() => {
    setAllModalsHidden(true);
    closeModalTimeout = null;
  }, 200);
};

async function submitNotVibing() {
  // Open the end-chat confirmation modal instead of native confirm()
  openModal('modal-end-chat');
}

// Wire up the end-chat confirm button
function wireEndChatConfirm() {
  const btn = document.getElementById('btn-end-chat-confirm');
  if (btn) {
    btn.onclick = async () => {
      closeModal();
      try {
        await apiCall('/api/connections/end', 'POST', { connection_id: currentConnId });
        try {
          sessionStorage.removeItem('discover_profiles');
          localStorage.removeItem('discover_profiles');
        } catch (e) {}
        window.location.href = 'discover.html';
      } catch(err) { showToast(err.message, 'error'); }
    };
  }
}

// Wire up in DOMContentLoaded if not already done
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireEndChatConfirm);
} else {
  wireEndChatConfirm();
}

async function submitIdentityRevealAction() {
  try {
    const data = await apiCall('/api/connections/identity-reveal', 'POST', { connection_id: currentConnId });
    if (data.bothRevealed && data.meeting_code) {
      closeModal();
      showMeetingModal(data.meeting_code);
    } else {
      // Switch to waiting state without closing the modal
      const countdownDiv = document.getElementById('identity-state-countdown');
      const promptDiv = document.getElementById('identity-state-prompt');
      const waitingDiv = document.getElementById('identity-state-waiting');
      if (countdownDiv) countdownDiv.classList.add('hidden');
      if (promptDiv) promptDiv.classList.add('hidden');
      if (waitingDiv) waitingDiv.classList.remove('hidden');
    }
    loadChatInfo();
  } catch(err) { showToast(err.message, 'error'); }
}

async function submitFaceRevealAction() {
  try {
    const data = await apiCall('/api/connections/face-reveal', 'POST', { connection_id: currentConnId });
    closeModal();
    if (data.bothRevealed && data.meeting_code) {
      showMeetingModal(data.meeting_code);
    }
    loadChatInfo();
  } catch(err) { showToast(err.message, 'error'); }
}

async function submitDeclineFaceReveal() {
  try {
    closeModal();
    await apiCall('/api/connections/decline-face-reveal', 'POST', { connection_id: currentConnId });
    loadChatInfo();
  } catch(err) { showToast(err.message, 'error'); }
}

async function disconnectAfterDecline() {
  try {
    closeModal();
    await apiCall('/api/connections/end-after-decline', 'POST', { connection_id: currentConnId });
    window.location.href = 'discover.html';
  } catch(err) { showToast(err.message, 'error'); }
}

function openExternalUrl(url) {
  if (!url) return;
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
      window.open(url, '_system');
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch (err) {
    window.location.href = url;
  }
}

function showMeetingModal(meetingCode) {
  const cleanCode = (meetingCode || '').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase() || 'delulu-room';
  
  // Instant direct 1-click working video room (Jitsi Meet — 100% free, no login, camera & mic work)
  const videoCallUrl = `https://meet.jit.si/Delulu-Meet-${cleanCode}`;

  const linkBtn = document.getElementById('meet-link-btn');
  if (linkBtn) {
    linkBtn.onclick = () => {
      openExternalUrl(videoCallUrl);
    };
  }

  const copyBtn = document.getElementById('meet-copy-btn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(videoCallUrl).then(() => {
          showToast('Meeting link copied!');
        }).catch(() => {
          showToast(`Link: ${videoCallUrl}`, 'info');
        });
      } else {
        showToast(`Link: ${videoCallUrl}`, 'info');
      }
    };
  }

  openModal('modal-google-meet');
}

// ===== Icebreaker Games =====
const GAME_QUESTIONS = {
  'would-you-rather': [
    { q: 'Travel to the past or the future?', a: 'Past', b: 'Future' },
    { q: 'Live in the mountains or by the beach?', a: 'Mountains', b: 'Beach' },
    { q: 'Be an early bird or a night owl?', a: 'Early bird', b: 'Night owl' },
    { q: 'Read the book or watch the movie?', a: 'Book', b: 'Movie' },
    { q: 'Cook a feast or order takeout?', a: 'Cook', b: 'Takeout' },
    { q: 'Have super strength or super speed?', a: 'Strength', b: 'Speed' },
    { q: 'Be famous or be happy?', a: 'Famous', b: 'Happy' },
    { q: 'Explore space or the deep ocean?', a: 'Space', b: 'Ocean' },
    { q: 'Always be 10 min late or 20 min early?', a: 'Late', b: 'Early' },
    { q: 'Have a pet dinosaur or a pet dragon?', a: 'Dinosaur', b: 'Dragon' },
    { q: 'Win $1,000,000 or find true love?', a: 'Money', b: 'Love' },
    { q: 'Go without phone for a week or without coffee/tea?', a: 'No Phone', b: 'No Caffeine' },
    { q: 'Only eat sweet foods or only spicy foods?', a: 'Sweet', b: 'Spicy' },
    { q: 'Have a private chef or a personal driver?', a: 'Chef', b: 'Driver' },
    { q: 'Never have to sleep or never have to work?', a: 'No Sleep', b: 'No Work' },
    { q: 'Have the ability to fly or be invisible?', a: 'Fly', b: 'Invisible' },
    { q: 'Sing karaoke or do stand-up comedy?', a: 'Karaoke', b: 'Comedy' },
    { q: 'Live in a tiny house in nature or a giant penthouse?', a: 'Tiny House', b: 'Penthouse' },
    { q: 'Have a time machine or a teleportation device?', a: 'Time Machine', b: 'Teleporter' },
    { q: 'Be a wizard or a superhero?', a: 'Wizard', b: 'Superhero' },
    { q: 'Be able to read minds or speak all languages?', a: 'Read Minds', b: 'All Languages' },
    { q: 'Go on a fancy dinner date or a cozy picnic?', a: 'Dinner Date', b: 'Cozy Picnic' },
    { q: 'Only watch horror movies or only watch rom-coms?', a: 'Horror', b: 'Rom-Com' },
    { q: 'Travel to a new country monthly or stay in your dream home?', a: 'Travel', b: 'Dream Home' },
    { q: 'Work dream job with low pay or boring job with huge pay?', a: 'Dream/Low Pay', b: 'Boring/Huge Pay' },
    { q: 'Always speak your mind or never speak again?', a: 'Always Speak', b: 'Never Speak' },
    { q: 'Wear sweatpants everywhere or formal clothes everywhere?', a: 'Sweatpants', b: 'Formal' },
    { q: 'Travel alone or travel with a group?', a: 'Alone', b: 'Group' },
    { q: 'Have a talking pet or a flying car?', a: 'Talking Pet', b: 'Flying Car' },
    { q: 'Be incredibly smart or incredibly lucky?', a: 'Smart', b: 'Lucky' },
    { q: 'Go skydiving or deep sea diving?', a: 'Skydiving', b: 'Sea Diving' },
    { q: 'Live without internet or live without music?', a: 'No Internet', b: 'No Music' },
    { q: 'Only communicate in emojis or only in whispers?', a: 'Emojis', b: 'Whispers' },
    { q: 'Be a famous musician or a famous actor?', a: 'Musician', b: 'Actor' },
    { q: 'Win an Olympic gold medal or a Nobel Prize?', a: 'Gold Medal', b: 'Nobel Prize' },
    { q: 'Travel to Mars or live under the sea?', a: 'Mars', b: 'Undersea' },
    { q: 'Always have to tell the truth or always have to lie?', a: 'Truth', b: 'Lie' },
    { q: 'Be the funniest person or the smartest?', a: 'Funniest', b: 'Smartest' },
    { q: 'Clean house/messy room or messy house/clean room?', a: 'Clean House', b: 'Clean Room' },
    { q: 'Have a rewind button or a pause button for life?', a: 'Rewind', b: 'Pause' },
    { q: 'Read minds or see the future?', a: 'Read Minds', b: 'See Future' },
    { q: 'Play video games all day or hike in the woods?', a: 'Video Games', b: 'Hike' },
    { q: 'Walk on hot coals or swim with sharks?', a: 'Hot Coals', b: 'Sharks' },
    { q: 'Love job/annoying peers or hate job/best friend peers?', a: 'Love Job', b: 'Best Friends' },
    { q: 'Lose the ability to taste or the ability to smell?', a: 'No Taste', b: 'No Smell' },
    { q: 'Wake up with new hair color daily or new eye color?', a: 'Hair Color', b: 'Eye Color' },
    { q: 'Dance every time you hear music or sing along?', a: 'Dance', b: 'Sing Along' },
    { q: 'Be expert at every instrument or every sport?', a: 'Instruments', b: 'Sports' },
    { q: 'Have a house with a huge pool or a huge home theater?', a: 'Pool', b: 'Home Theater' },
    { q: 'Never use social media again or never watch TV?', a: 'No Socials', b: 'No TV' },
    { q: 'Go on an adventurous road trip or a luxury cruise?', a: 'Road Trip', b: 'Luxury Cruise' },
    { q: 'Be able to freeze time or speed up time?', a: 'Freeze Time', b: 'Speed Time' },
    { q: 'Wake up early for sunrise or stay up late for stars?', a: 'Sunrise', b: 'Stars' },
    { q: 'Only eat pizza for a year or only eat burgers?', a: 'Pizza Only', b: 'Burgers Only' },
    { q: 'Be a master chef or a master detective?', a: 'Master Chef', b: 'Detective' },
    { q: 'Have conversation with future self or past self?', a: 'Future Self', b: 'Past Self' },
    { q: 'Have unlimited energy or unlimited sleep?', a: 'Energy', b: 'Sleep' },
    { q: 'Be able to change height or change voice?', a: 'Height', b: 'Voice' },
    { q: 'Go to wild music festival or quiet cabin retreat?', a: 'Festival', b: 'Cabin' }
  ],
  'this-or-that': [
    { q: 'Coffee or Tea?', a: 'Coffee', b: 'Tea' },
    { q: 'Pizza or Burger?', a: 'Pizza', b: 'Burger' },
    { q: 'Sweet or Spicy?', a: 'Sweet', b: 'Spicy' },
    { q: 'Netflix or YouTube?', a: 'Netflix', b: 'YouTube' },
    { q: 'Cats or Dogs?', a: 'Cats', b: 'Dogs' },
    { q: 'Summer or Winter?', a: 'Summer', b: 'Winter' },
    { q: 'City or Nature?', a: 'City', b: 'Nature' },
    { q: 'Beach or Pool?', a: 'Beach', b: 'Pool' },
    { q: 'Text or Call?', a: 'Text', b: 'Call' },
    { q: 'Instagram or TikTok?', a: 'Instagram', b: 'TikTok' },
    { q: 'iOS or Android?', a: 'iOS', b: 'Android' },
    { q: 'Morning or Night?', a: 'Morning', b: 'Night' },
    { q: 'Dine-in or Takeout?', a: 'Dine-in', b: 'Takeout' },
    { q: 'Dark chocolate or Milk chocolate?', a: 'Dark Chocolate', b: 'Milk Chocolate' },
    { q: 'Plan everything or Wing it?', a: 'Plan Everything', b: 'Wing It' },
    { q: 'Pop or Rock music?', a: 'Pop', b: 'Rock' },
    { q: 'Books or Podcasts?', a: 'Books', b: 'Podcasts' },
    { q: 'Comedy or Drama?', a: 'Comedy', b: 'Drama' },
    { q: 'Beer or Wine?', a: 'Beer', b: 'Wine' },
    { q: 'Casual wear or Dressed up?', a: 'Casual Wear', b: 'Dressed Up' },
    { q: 'Concert or Movie theater?', a: 'Concert', b: 'Movie Theater' },
    { q: 'Board games or Video games?', a: 'Board Games', b: 'Video Games' },
    { q: 'Road trip or Flight?', a: 'Road Trip', b: 'Flight' },
    { q: 'Rainy days or Sunny days?', a: 'Rainy Days', b: 'Sunny Days' },
    { q: 'Hot tub or Cold plunge?', a: 'Hot Tub', b: 'Cold Plunge' },
    { q: 'Sneakers or Boots?', a: 'Sneakers', b: 'Boots' },
    { q: 'Pancakes or Waffles?', a: 'Pancakes', b: 'Waffles' },
    { q: 'Tattoos or Piercings?', a: 'Tattoos', b: 'Piercings' },
    { q: 'Physical books or E-books?', a: 'Physical Books', b: 'E-Books' },
    { q: 'Staying in or Going out?', a: 'Staying In', b: 'Going Out' },
    { q: 'Talking or Listening?', a: 'Talking', b: 'Listening' },
    { q: 'Rollercoasters or Water slides?', a: 'Rollercoasters', b: 'Water Slides' },
    { q: 'Theme park or Museum?', a: 'Theme Park', b: 'Museum' },
    { q: 'Pasta or Sushi?', a: 'Pasta', b: 'Sushi' },
    { q: 'Left brain or Right brain?', a: 'Left Brain', b: 'Right Brain' },
    { q: 'Sunrise or Sunset?', a: 'Sunrise', b: 'Sunset' },
    { q: 'Marvel or DC?', a: 'Marvel', b: 'DC' },
    { q: 'Chocolate or Vanilla?', a: 'Chocolate', b: 'Vanilla' },
    { q: 'Pepsi or Coke?', a: 'Pepsi', b: 'Coke' },
    { q: 'Star Wars or Star Trek?', a: 'Star Wars', b: 'Star Trek' },
    { q: 'Live music or Studio recordings?', a: 'Live Music', b: 'Studio' },
    { q: 'Mountains or Oceans?', a: 'Mountains', b: 'Oceans' },
    { q: 'Big party or Small gathering?', a: 'Big Party', b: 'Small Gathering' },
    { q: 'Silver or Gold jewelry?', a: 'Silver', b: 'Gold' },
    { q: 'Reality TV or Documentaries?', a: 'Reality TV', b: 'Documentary' },
    { q: 'Modern decor or Vintage/Retro?', a: 'Modern Decor', b: 'Vintage/Retro' },
    { q: 'Hot coffee or Iced coffee?', a: 'Hot Coffee', b: 'Iced Coffee' },
    { q: 'Tacos or Nachos?', a: 'Tacos', b: 'Nachos' },
    { q: 'Cooking or Baking?', a: 'Cooking', b: 'Baking' },
    { q: 'Fruit or Veggies?', a: 'Fruit', b: 'Veggies' },
    { q: 'Long hair or Short hair?', a: 'Long Hair', b: 'Short Hair' },
    { q: 'Traveling abroad or Staycation?', a: 'Traveling Abroad', b: 'Staycation' },
    { q: 'Amusement park or Zoo?', a: 'Amusement Park', b: 'Zoo' },
    { q: 'Bubble bath or Hot shower?', a: 'Bubble Bath', b: 'Hot Shower' },
    { q: 'Ice cream cone or Ice cream tub?', a: 'Ice Cream Cone', b: 'Ice Cream Tub' },
    { q: 'Smart casual or Athleisure?', a: 'Smart Casual', b: 'Athleisure' }
  ],
  'truths-lie': []
};

let currentGame = null;
let gameTimeout = null;
// Minimum lifetime for game cards (in ms). Prevents transient Firestore snapshot
// races from removing a game card that was just created.
const GAME_CARD_MIN_LIFETIME = 3000;
let _gameCardCreatedAt = 0;

function openIcebreakerModal() {
  openModal('modal-icebreaker');
  const gamesList = document.getElementById('icebreaker-games-list');
  if (!gamesList) return;
  gamesList.innerHTML = `
    <button data-game="would-you-rather" class="w-full text-left p-3 rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors">
      <span class="font-bold">Would You Rather</span>
      <p class="text-xs text-on-surface-variant mt-1">Classic icebreaker — pick your poison!</p>
    </button>
    <button data-game="this-or-that" class="w-full text-left p-3 rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors">
      <span class="font-bold">⚡ This or That</span>
      <p class="text-xs text-on-surface-variant mt-1">Quick preferences — compare your tastes!</p>
    </button>
    <button data-game="question" class="w-full text-left p-3 rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors">
      <span class="font-bold">❓ Random Question</span>
      <p class="text-xs text-on-surface-variant mt-1">Send an anonymous question to break the ice!</p>
    </button>
  `;
  
  gamesList.querySelectorAll('[data-game]').forEach(btn => {
    btn.onclick = () => {
      const game = btn.getAttribute('data-game');
      startGame(game);
    };
  });
let isStartingIcebreaker = false;

async function startGame(gameType) {
  // Guard: if an active game card already exists or creation is in progress, lock double taps
  const existingCard = document.querySelector('[id^="game-"]');
  if (existingCard && gameType !== 'question') {
    showToast('An icebreaker game is already active!');
    closeModal();
    return;
  }
  if (isStartingIcebreaker) return;
  isStartingIcebreaker = true;

  try {
    const questions = GAME_QUESTIONS[gameType] || GAME_QUESTIONS['would-you-rather'];
  const q = questions[Math.floor(Math.random() * questions.length)];
  
  if (gameType === 'question') {
    // Send a random question to the other user
    const randomQs = [
      "What's your most irrational fear?",
      "What's the best food you've ever had?",
      "If you could live anywhere, where would it be?",
      "What's a skill you'd love to learn?",
      "What's your favorite way to spend a weekend?",
      "What movie can you watch over and over?",
      "What's the most spontaneous thing you've done?",
      "What's your hidden talent?",
      "What's your absolute dream job if money didn't matter?",
      "What's your go-to karaoke song?",
      "If you could have dinner with any historical figure, who would it be?",
      "What's the best concert you've ever attended?",
      "What's a purchase under $100 that changed your life?",
      "What's your favorite childhood memory?",
      "If you won the lottery today, what's the first thing you'd buy?",
      "What's the weirdest food combination you actually enjoy?",
      "What's your favorite book of all time?",
      "What's the best advice you've ever received?",
      "What's a major red flag in a person for you?",
      "What's your favorite holiday and why?",
      "If your life was a movie, what would the title be?",
      "What's the most adventurous thing on your bucket list?",
      "What's your favorite season and why?",
      "If you could only eat one food for the rest of your life, what is it?",
      "What's your biggest pet peeve?",
      "What's the last song you listened to on repeat?",
      "Who is your biggest role model?",
      "What's your favorite city you've ever visited?",
      "What's something you're passionate about right now?",
      "If you could have any superpower, what would it be?",
      "What's your favorite board game or card game?",
      "What's a hobby you've always wanted to try?",
      "What's the most unusual place you've ever slept?",
      "What's your favorite way to de-stress after a long day?",
      "If you could speak any foreign language fluently, what would it be?",
      "What's the worst movie you've ever watched?",
      "What's your signature dish to cook?",
      "What's something that always makes you laugh?",
      "If you could travel to any planet, where would you go?",
      "What's your favorite dessert of all time?",
      "What's the most interesting fact you know?",
      "If you could be any animal for a day, what would you be?",
      "What's your favorite video game of all time?",
      "What's the longest road trip you've ever taken?",
      "What's your favorite quote or saying?",
      "If you could master any musical instrument, which one would it be?",
      "What's the most beautiful natural place you've ever seen?",
      "What's a fashion trend you wish would die or come back?",
      "What's something you've recently accomplished that you're proud of?",
      "If you could open any theme restaurant, what would the theme be?",
      "What's your favorite kind of exercise or sport?",
      "What's the most useless object you own?",
      "If you were a color, what color would you be?",
      "What's your favorite app on your phone?",
      "What's the best gift you've ever received?",
      "What's your favorite family tradition?",
      "If you could solve one global mystery, which one would it be?",
      "What's your favorite thing about your best friend?",
      "What is one goal you want to achieve before the year ends?"
    ];
    const randomQ = randomQs[Math.floor(Math.random() * randomQs.length)];
    const msg = `🎲 Icebreaker Question: ${randomQ}`;
    
    // Save random question permanently in the database so it never disappears on refresh
    // Also append optimistically so the user sees instant feedback (no dead tap)
    const tempId = 'temp-' + Date.now();
    appendMessage({
      tempId,
      is_sending: true,
      sender_id: currentUser.id,
      content: msg,
      is_encrypted: 0,
      created_at: new Date().toISOString()
    }, true);
    (async () => {
      if (!currentConnId) return; // Guard: connection must be active
      let payload = { connection_id: currentConnId, content: msg };
      if (isE2EEActive && sharedSecretKey) {
        try {
          const encrypted = await E2EECrypto.encryptMessage(msg, sharedSecretKey);
          payload.content = encrypted.ciphertext;
          payload.is_encrypted = 1;
          payload.iv = encrypted.iv;
        } catch (encErr) {
          console.error('Failed to encrypt random question:', encErr);
        }
      }
      const result = await apiCall('/api/messages/send', 'POST', payload);
      // Mark as sent when confirmed by server
      const msgEl = document.getElementById(tempId);
      if (msgEl) {
        msgEl.classList.remove('opacity-60');
        if (result && result.message && result.message.id) {
          msgEl.setAttribute('data-msg-id', result.message.id);
          if (result.message.created_at) {
            lastMessageTimestamp = result.message.created_at;
          }
          if (typeof messageCache !== 'undefined') {
            messageCache.cacheSingleMessage(currentConnId, result.message).catch(() => {});
          }
        }
        msgEl.removeAttribute('id');
      }
    })().catch(err => {
      console.error('Failed to send random question message:', err);
      // Mark as failed on error
      const msgEl = document.getElementById(tempId);
      if (msgEl) {
        msgEl.classList.remove('opacity-60');
        const innerEl = msgEl.querySelector('div');
        if (innerEl) {
          innerEl.classList.remove('bg-primary');
          innerEl.classList.add('bg-error/10', 'border', 'border-error/30', 'text-error');
        }
        const timeEl = msgEl.querySelector('.text-\\[10px\\]');
        if (timeEl) {
          timeEl.className = 'text-[10px] mt-1 text-right text-error font-bold';
          timeEl.textContent = 'Failed to send';
        }
      }
    });
  } else {
    // STEP 1: Save game to Firestore FIRST
    let activeGame;
    try {
      const result = await apiCall(`/api/connections/${currentConnId}/start-game`, 'POST', { game_type: gameType, question: q });
      activeGame = result.active_game; // includes created_at from Firestore
    } catch (err) {
      console.error('Failed to start persistent game:', err);
      showToast(err.message || 'Could not start the icebreaker. Please try again.', 'error');
      return;
    }
    
    // Render locally from the API response so the starter sees the card instantly.
    if (otherUserId) {
      const fakeConn = {
        from_user_id: currentUser.id,
        to_user_id: otherUserId,
        active_game: activeGame
      };
    }
  } catch (err) {
    console.error('Error starting icebreaker:', err);
  } finally {
    isStartingIcebreaker = false;
    closeModal();
  }
}

function syncActiveGame(c) {
  console.log("[syncActiveGame] c.active_game:", JSON.stringify(c.active_game || null));
  console.log("[syncActiveGame] currentUser:", JSON.stringify(currentUser));
  console.log("[syncActiveGame] connection info:", `from=${c.from_user_id}, to=${c.to_user_id}`);
  const existingGame = document.querySelector('[id^="game-"]');
  if (!c.active_game) {
    // If the game card is currently displaying the match result to the user,
    // let its fade-out timer finish so the user actually sees "You matched!" or "Different picks"
    if (existingGame && existingGame.dataset.clearScheduled === '1') {
      return;
    }
    // Minimum lifetime guard: don't remove game cards that were created within
    // the last GAME_CARD_MIN_LIFETIME ms. This prevents transient Firestore
    // snapshot races or connection-refetch issues from removing a card that
    // was just created and hasn't propagated yet.
    if (existingGame && Date.now() - _gameCardCreatedAt < GAME_CARD_MIN_LIFETIME) {
      return;
    }
    // Defense-in-depth: only remove if the tracked game matches.
    // Prevents a stale status_change from clear-game removing a newly created game.
    if (existingGame && currentGame && existingGame.id === currentGame.domId) {
      existingGame.remove();
      currentGame = null;
    } else if (existingGame && !currentGame) {
      // No tracked game — safe to remove (no new game could be using it)
      existingGame.remove();
    }
    return;
  }
  
  const game = c.active_game;
  
  // Helper: convert created_at (ISO string OR Firestore Timestamp object)
  // to numeric milliseconds for safe comparison.
  function _gameTime(ts) {
    if (!ts) return 0;
    if (typeof ts === 'object' && ts.toDate) return ts.toDate().getTime();
    const parsed = new Date(ts).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  
  // Generate a stable game ID. If we already have a tracked game with the same
  // created_at (same game), reuse its domId. Otherwise, the random suffix would
  // change on every syncActiveGame call, causing the card to be removed/recreated
  // on every Firestore snapshot or socket event.
  // NOTE: created_at can be either an ISO string (from API JSON) or a
  // Firestore Timestamp object (from onSnapshot). Using numeric comparison
  // handles both formats.
  let gameId;
  if (currentGame && _gameTime(currentGame.created_at) === _gameTime(game.created_at)) {
    gameId = currentGame.domId;
  } else {
    gameId = 'game-' + _gameTime(game.created_at) + '-' + Math.random().toString(36).slice(2, 6);
  }
  
  const answers = game.answers || {};
  const question = game.question || {};
  const myAnswer = answers[String(currentUser.id)] || null;
  const otherId = otherUserId || (Number(c.from_user_id) === Number(currentUser.id) ? Number(c.to_user_id) : Number(c.from_user_id));
  const otherAnswer = answers[String(otherId)] || null;
  if (currentGame && _gameTime(currentGame.created_at) === _gameTime(game.created_at)) {
    currentGame.myAnswer = myAnswer;
    currentGame.otherAnswer = otherAnswer;
  }
  
  if (!existingGame || existingGame.id !== gameId) {
    if (existingGame) existingGame.remove();
    
    // Normalize created_at to a clean ISO string so the server's clearGame transaction
    // can reliably compare it with activeGame.created_at via ===. Without this, the
    // value could be a Firestore Timestamp object (from onSnapshot) which would fail
    // string comparison against the ISO string stored in Firestore.
    const createdMs = _gameTime(game.created_at);
    currentGame = { domId: gameId, gameType: game.game_type, question: game.question, myAnswer, otherAnswer, created_at: new Date(createdMs).toISOString() };
    // Record creation time for minimum lifetime guard
    _gameCardCreatedAt = Date.now();
    
    const msgDiv = document.createElement('div');
    msgDiv.className = 'w-full flex justify-center my-3 fade-in';
    msgDiv.id = gameId;
    msgDiv.dataset.gameCreatedAt = currentGame.created_at;
    
    msgDiv.innerHTML = `
      <div class="bg-surface-container-low rounded-2xl p-4 max-w-sm w-full border border-outline-variant/20 shadow-sm text-center">
        <div class="text-xs font-bold text-primary mb-2 uppercase tracking-wider">${game.game_type === 'would-you-rather' ? 'Would You Rather' : 'This or That'}</div>
        <p class="font-bold text-on-surface mb-3">${escapeHtml(question.q || 'Pick one')}</p>
        <div class="flex gap-3">
          <button data-game-answer="A" class="flex-1 py-2 px-3 rounded-xl bg-surface-container-high text-on-surface hover:bg-primary hover:text-white font-semibold text-sm transition-all">${escapeHtml(question.a || 'A')}</button>
          <button data-game-answer="B" class="flex-1 py-2 px-3 rounded-xl bg-surface-container-high text-on-surface hover:bg-primary hover:text-white font-semibold text-sm transition-all">${escapeHtml(question.b || 'B')}</button>
        </div>
        <p class="text-[10px] text-on-surface-variant mt-2" id="game-status-text">Make your pick to see if you match!</p>
      </div>
    `;
    
    const cont = document.getElementById('chat-messages');
    cont.prepend(msgDiv);
    
    // Scroll to show the game card (prepended at bottom of flex-col-reverse)
    scrollToBottom();
    
    msgDiv.querySelectorAll('[data-game-answer]').forEach(btn => {
      btn.onclick = async () => {
        const answer = btn.getAttribute('data-game-answer');
        btn.parentElement.querySelectorAll('[data-game-answer]').forEach(b => {
          b.style.opacity = '0.5';
          b.disabled = true;
        });
        btn.style.opacity = '1';
        btn.style.background = 'var(--primary, #a53b29)';
        btn.style.color = 'white';
        
        currentGame.myAnswer = answer;
        
        try {
          const res = await apiCall(`/api/connections/${currentConnId}/answer-game`, 'POST', { answer });
          if (res.gameData) {
            syncActiveGame({
              from_user_id: currentUser.id,
              to_user_id: otherId,
              active_game: res.gameData
            });
          }
          
          const latestAnswers = (res.gameData && res.gameData.answers) || {};
          const latestOtherAnswer = latestAnswers[String(otherId)] || null;
          if (res.bothAnswered && latestOtherAnswer) {
            handleBothAnswered(document.getElementById(gameId) || msgDiv, answer, latestOtherAnswer);
          }
        } catch (err) {
          showToast(err.message, 'error');
          // Re-enable buttons on API failure so the user can retry their answer.
          // Without this, the buttons stay disabled and the game is stuck.
          btn.parentElement.querySelectorAll('[data-game-answer]').forEach(b => {
            b.style.opacity = '';
            b.style.background = '';
            b.style.color = '';
            b.disabled = false;
          });
          currentGame.myAnswer = null;
        }
      };
    });
  }
  
  const gameEl = document.getElementById(gameId);
  if (gameEl) {
    const statusTextEl = gameEl.querySelector('#game-status-text');
    const buttons = gameEl.querySelectorAll('[data-game-answer]');
    
    if (myAnswer) {
      buttons.forEach(btn => {
        btn.disabled = true;
        const ans = btn.getAttribute('data-game-answer');
        if (ans === myAnswer) {
          btn.style.opacity = '1';
          btn.style.background = 'var(--primary, #a53b29)';
          btn.style.color = 'white';
        } else {
          btn.style.opacity = '0.5';
        }
      });
    }
    
    if (myAnswer && otherAnswer) {
      handleBothAnswered(gameEl, myAnswer, otherAnswer);
    } else if (myAnswer) {
      if (statusTextEl) {
        statusTextEl.textContent = 'Wait for the other person to answer too...';
        statusTextEl.className = 'text-[10px] text-on-surface-variant mt-2';
      }
    } else if (otherAnswer) {
      if (statusTextEl) {
        statusTextEl.textContent = 'The other person has answered! Make your pick to see if you match.';
        statusTextEl.className = 'text-[10px] text-primary font-semibold mt-2 animate-pulse';
      }
    } else {
      if (statusTextEl) {
        statusTextEl.textContent = 'Make your pick to see if you match!';
        statusTextEl.className = 'text-[10px] text-on-surface-variant mt-2';
      }
    }
  }
}

function handleBothAnswered(gameEl, myAns, otherAns) {
  const isMatch = myAns === otherAns;
  const resultText = isMatch 
    ? 'You matched! Great minds think alike!'
    : 'Different picks — opposites attract!';
  
  const statusTextEl = gameEl.querySelector('#game-status-text');
  if (statusTextEl) {
    statusTextEl.textContent = resultText;
    statusTextEl.className = 'text-xs font-bold mt-2 ' + (isMatch ? 'text-green-600 dark:text-green-400' : 'text-primary');
  }
  
  gameEl.querySelectorAll('[data-game-answer]').forEach(b => {
    b.style.opacity = '0.5';
    b.disabled = true;
  });

  if (gameEl.dataset.clearScheduled === '1') return;
  gameEl.dataset.clearScheduled = '1';
  const createdAtForClear = gameEl.dataset.gameCreatedAt || null;
  
  setTimeout(async () => {
    // Guard: if the card was already removed by syncActiveGame, skip fade-out
    if (!gameEl.isConnected) return;
    
    gameEl.classList.add('transition-opacity', 'duration-300', 'opacity-0');
    setTimeout(() => {
      if (gameEl.isConnected) gameEl.remove();
      if (currentGame && currentGame.domId === gameEl.id) currentGame = null;
    }, 300);
    
    try {
      await apiCall(`/api/connections/${currentConnId}/clear-game`, 'POST', { game_created_at: createdAtForClear });
    } catch (e) {}
  }, 1000);
}

// ===== Report & Block =====
async function submitReport() {
  const reasonEl = document.getElementById('report-reason');
  let reason = reasonEl ? reasonEl.value.trim() : '';
  const detailsEl = document.getElementById('report-details');
  const details = detailsEl ? detailsEl.value.trim() : '';
  if (details) {
    reason += ': ' + details;
  }
  if (!reason) {
    showToast('Please select or enter a reason');
    return;
  }
  if (reason.length > 1000) {
    showToast('Report reason is too long. Please keep it under 1000 characters.');
    return;
  }
  
  const btn = document.getElementById('btn-report-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  
  try {
    const data = await apiCall('/api/connections/' + currentConnId);
    const otherId = data.connection.other_user_id;
    await apiCall('/api/users/report', 'POST', {
      reported_user_id: otherId,
      reason,
      connection_id: currentConnId
    });
    closeModal();
    showToast('Report submitted. Our team will review it.');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Report'; }
  }
}

async function blockUser() {
  if (!confirm('Block this user? You won\'t be able to chat anymore. This can\'t be undone.')) return;
  
  try {
    const data = await apiCall('/api/connections/' + currentConnId);
    const otherId = data.connection.other_user_id;
    await apiCall('/api/users/block', 'POST', { blocked_user_id: otherId });
    showToast('User blocked.');
    window.location.href = 'messages.html';
  } catch (err) {
    showToast(err.message, 'error');
  }
}


// ===== Screenshot & Screen Recording Protection =====
function setupScreenshotProtection() {
  const chatMessages = document.getElementById('chat-messages');

  // 1. Intercept PrintScreen and common screenshot key shortcuts
  window.addEventListener('keydown', (e) => {
    const isPrintScreen = e.key === 'PrintScreen' || e.keyCode === 44;
    const isCmdShift = (e.metaKey || e.ctrlKey) && e.shiftKey && ['3', '4', '5', 'S', 's', 'i', 'I'].includes(e.key);
    const isCtrlP = (e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P');

    if (isPrintScreen || isCmdShift || isCtrlP) {
      e.preventDefault();
      e.stopPropagation();

      if (chatMessages) {
        chatMessages.style.filter = 'blur(30px)';
        setTimeout(() => {
          chatMessages.style.filter = 'none';
        }, 1500);
      }
      if (typeof showToast === 'function') {
        showToast('Screenshots are restricted in Delulu chats for privacy', 'warning');
      }
      return false;
    }
  });

  // 2. Blur chat area when window loses focus (protects background capture & task switcher preview)
  window.addEventListener('blur', () => {
    if (chatMessages) chatMessages.style.filter = 'blur(25px)';
  });
  window.addEventListener('focus', () => {
    if (chatMessages) chatMessages.style.filter = 'none';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && chatMessages) {
      chatMessages.style.filter = 'blur(25px)';
    } else if (!document.hidden && chatMessages) {
      chatMessages.style.filter = 'none';
    }
  });

  // 3. Disable right-click context menu on chat view
  const mainChatArea = document.getElementById('app-root') || document.body;
  if (mainChatArea) {
    mainChatArea.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupScreenshotProtection);
} else {
  setupScreenshotProtection();
}
