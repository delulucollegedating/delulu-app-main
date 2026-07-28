// Per-user SSE stream for real-time messages list updates
let userEventSource = null;
let _sseBackoffMs = 2000; // starts at 2s, doubles up to 30s
let _sseBackoffTimer = null;
let _totalUnread = 0;

function initUserStream() {
  if (userEventSource) return;
  userEventSource = new EventSource(resolveUrl('/api/user/stream'));

  userEventSource.onmessage = (event) => {
    if (!event.data || event.data.startsWith(':')) return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    // Reset backoff on successful message
    _sseBackoffMs = 2000;

    if (data.type === 'chat_ended') {
      // Clear localStorage cache so the ended chat doesn't flash back on page reload
      try { localStorage.removeItem('cached_messages_list'); } catch (e) {}
      // Refresh the messages list instantly when a chat is ended
      loadMessagesList({ skipRecent: false });
    } else if (data.type === 'message') {
      // Update chat list row in-place
      updateChatListItem({
        connectionId: data.connectionId,
        lastMessage: data.lastMessage,
        lastMessageTime: data.lastMessageTime,
        senderId: data.senderId,
        senderName: data.senderName
      });

      // Only show in-app notification when the user is NOT already in that chat
      const activeChatId = new URLSearchParams(window.location.search).get('id');
      const isActiveChat = String(activeChatId) === String(data.connectionId);

      if (!isActiveChat) {
        // Rich Telegram-style toast with sender name
        if (typeof window.showRichToast === 'function') {
          window.showRichToast({
            senderName: data.senderName || 'New message',
            preview: data.lastMessage || '',
            connectionId: data.connectionId,
          });
        }

        // Increment unread count in tab title
        _totalUnread++;
        if (typeof window.setTitleUnread === 'function') {
          window.setTitleUnread(_totalUnread);
        }

        // Native notification if app is backgrounded
        if (document.hidden && typeof window.showNativeNotification === 'function') {
          window.showNativeNotification({
            title: data.senderName ? `${data.senderName} on Delulu` : 'New message',
            body: data.lastMessage || 'You have a new message',
            url: `chat.html?id=${data.connectionId}`,
            id: data.connectionId
          });
        }
      }
    }
  };

  userEventSource.onerror = () => {
    userEventSource = null;
    // Exponential backoff: 2s → 4s → 8s → 16s → 30s cap
    const delay = _sseBackoffMs;
    _sseBackoffMs = Math.min(_sseBackoffMs * 2, 30000);
    clearTimeout(_sseBackoffTimer);
    _sseBackoffTimer = setTimeout(initUserStream, delay);
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  await requireAuth();
  loadMessagesList();
  initUserStream();

  // Auto-refresh when tab becomes visible (compensates for mock socket)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadMessagesList({ skipRecent: true });
      // Reconnect SSE if it dropped while backgrounded
      if (!userEventSource) initUserStream();
    }
  });

  if (socket) {
    
    // Real-time chat list updates
    socket.on('chat-update', (data) => {
      updateChatListItem(data);
    });
    
    // Presence updates for chat list
    socket.on('user-online', (data) => {
      updatePresenceDot(data.userId, true);
    });
    socket.on('user-offline', (data) => {
      updatePresenceDot(data.userId, false);
    });
    
    // Update messages list when a message is read
    socket.on('messages-read', (data) => {
      const conn = chatListCache.find(c => c.id == data.connectionId);
      if (conn) {
        conn.last_read = true;
        const list = document.getElementById('messages-list');
        if (list) {
          const links = list.querySelectorAll('a');
          links.forEach(link => {
            if (link.href.includes(`chat.html?id=${data.connectionId}`) || link.href.includes(`/chat?id=${data.connectionId}`)) {
              const safeUsername = escapeHtml(conn.other_username);
              const isRevealed = conn.status === 'revealed';
              const lastMsg = renderLastMessage(conn);
              link.outerHTML = renderChatListItem(conn, safeUsername, isRevealed, lastMsg);
            }
          });
        }
      }
    });
  }
});

// Cache of connection data for live updates
let chatListCache = [];
let lastMessagesListLoadAt = 0;

// In-flight guard to prevent concurrent API calls if multiple socket events fire
// before the first fetch completes. The second call simply returns early.
let _messagesListLoading = false;

async function loadMessagesList(options = {}) {
  if (_messagesListLoading) return;
  if (options.skipRecent && Date.now() - lastMessagesListLoadAt < 5000) return;
  _messagesListLoading = true;
  const list = document.getElementById('messages-list');

  // Instant zero-latency render from local storage cache (eliminates skeleton waiting time)
  if (!chatListCache.length) {
    try {
      const cached = localStorage.getItem('cached_messages_list');
      if (cached) {
        chatListCache = JSON.parse(cached);
        if (chatListCache.length > 0) {
          list.innerHTML = chatListCache.map(c => {
            const safeUsername = escapeHtml(c.other_username);
            const isRevealed = c.status === 'revealed';
            const lastMsg = renderLastMessage(c);
            return renderChatListItem(c, safeUsername, isRevealed, lastMsg);
          }).join('');
        }
      }
    } catch (e) {}

    // Only show skeleton if no cache exists at all
    if (!chatListCache.length) {
      showSkeleton('messages-list', 4, 'card');
    }
  }

  try {
    const data = await apiCall('/api/connections/active');
    lastMessagesListLoadAt = Date.now();
    const conns = data.connections;
    chatListCache = conns;
    
    // Save to local cache for instant cold starts
    try {
      localStorage.setItem('cached_messages_list', JSON.stringify(conns));
    } catch (e) {}
    
    if (!conns || conns.length === 0) {
      list.innerHTML = `<div class="p-8 text-center text-on-surface-variant flex flex-col items-center"><span class="material-symbols-outlined text-4xl mb-2">forum</span> No active chats yet.</div>`;
      return;
    }
    
    list.innerHTML = conns.map(c => {
      const safeUsername = escapeHtml(c.other_username);
      const isRevealed = c.status === 'revealed';
      const lastMsg = renderLastMessage(c);
      return renderChatListItem(c, safeUsername, isRevealed, lastMsg);
    }).join('');

    // Request presence info for connected users
    if (socket) {
      conns.forEach(c => {
        if (c.other_user_id) {
          socket.emit('request-presence', { userId: c.other_user_id });
        }
      });
    }
  } catch (err) {
    if (!chatListCache.length) {
      list.innerHTML = `<div class="p-4 text-error">${escapeHtml(err.message)}</div>`;
    }
  } finally {
    _messagesListLoading = false;
  }
}

function renderLastMessage(c) {
  // This is now used only as a fallback; main preview rendered inside renderChatListItem
  if (!c.last_message) return '';
  return c.last_message.length > 45
    ? escapeHtml(c.last_message.substring(0, 45)) + '…'
    : escapeHtml(c.last_message);
}

function renderChatListItem(c, safeUsername, isRevealed, lastMsg) {
  const isUnread = c.last_sender_id && Number(c.last_sender_id) !== Number(currentUser?.id) && !c.last_read;
  const isSentByMe = c.last_sender_id && Number(c.last_sender_id) === Number(currentUser?.id);

  // Build preview text
  let previewText = '';
  let previewPrefix = '';
  let previewIcon = '';
  if (!c.last_message) {
    previewText = isRevealed
      ? 'Identities Revealed'
      : '<span class="italic text-on-surface-variant/50">Tap to start chatting</span>';
  } else {
    const raw = c.last_message.length > 48
      ? escapeHtml(c.last_message.substring(0, 48)) + '\u2026'
      : escapeHtml(c.last_message);
    previewText = raw;
  }
  if (isSentByMe && c.last_message) {
    previewPrefix = '<span class="text-on-surface-variant/70">You: </span>';
  }

  return `
    <a href="chat.html?id=${c.id}" class="tg-chat-row ${isUnread ? 'unread-row' : ''}">
      <!-- Avatar + presence dot -->
      <div class="relative shrink-0">
        <div class="w-[52px] h-[52px] rounded-full overflow-hidden shadow-sm">
          ${getAvatarHtml(c.other_username, c.other_avatar)}
        </div>
        <div class="presence-dot absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full border-2 border-surface bg-emerald-500 hidden" data-user-id="${c.other_user_id}"></div>
      </div>
      <!-- Text info -->
      <div class="flex-1 min-w-0">
        <!-- Row 1: name + time -->
        <div class="flex items-center justify-between mb-0.5">
          <span class="font-bold text-on-surface capitalize truncate text-[15px] leading-snug">${safeUsername}</span>
          <div class="flex items-center gap-1 shrink-0 ml-2">
            ${isSentByMe ? `<span class="material-symbols-outlined text-[13px] ${c.last_read ? 'text-blue-500' : 'text-on-surface-variant/40'}" style="font-variation-settings:'FILL' ${c.last_read ? 1 : 0}">done_all</span>` : ''}
            ${c.last_message_time ? `<span class="text-[11.5px] whitespace-nowrap ${isUnread ? 'text-primary font-semibold' : 'text-on-surface-variant/60'}">${formatChatTime(c.last_message_time)}</span>` : ''}
          </div>
        </div>
        <!-- Row 2: preview + unread badge -->
        <div class="flex items-center justify-between gap-2">
          <p class="text-[13px] truncate leading-snug ${isUnread ? 'font-medium text-on-surface' : 'text-on-surface-variant'}">${previewPrefix}${previewIcon}${previewText}</p>
          ${isUnread ? '<div class="unread-badge">1</div>' : ''}
        </div>
      </div>
    </a>
  `;
}

function formatChatTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const d = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today - msgDay) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Real-time update a single chat list item via socket
function updateChatListItem(data) {
  const { connectionId, lastMessage, lastMessageTime, senderId } = data;
  
  // Use findIndex immediately to capture the index BEFORE any concurrent modification.
  // Using indexOf(conn) after other operations is racy because a concurrent call
  // may have already spliced the reference out of the array, causing splice(-1, 1)
  // to remove the wrong element.
  const idx = chatListCache.findIndex(c => c.id == connectionId);
  if (idx === -1) {
    // Reload full list if we don't have this connection cached
    loadMessagesList();
    return;
  }
  
  const conn = chatListCache[idx];
  conn.last_message = lastMessage;
  conn.last_message_time = lastMessageTime;
  conn.last_sender_id = senderId;
  
  // If the current user sent the message (via API), mark as read immediately
  if (Number(senderId) === Number(currentUser?.id)) {
    conn.last_read = true;
  } else {
    conn.last_read = false;
  }
  
  const list = document.getElementById('messages-list');
  if (!list) return;
  
  // Move this connection to the top and re-render
  chatListCache.splice(idx, 1);
  chatListCache.unshift(conn);
  
  list.innerHTML = chatListCache.map(c => {
    const safeUsername = escapeHtml(c.other_username);
    const isRevealed = c.status === 'revealed';
    const lastMsg = renderLastMessage(c);
    return renderChatListItem(c, safeUsername, isRevealed, lastMsg);
  }).join('');
}

// Update presence dot for a user in the chat list
function updatePresenceDot(userId, isOnline) {
  const dot = document.querySelector(`.presence-dot[data-user-id="${userId}"]`);
  if (dot) {
    if (isOnline) {
      dot.classList.remove('hidden');
      dot.style.background = '#22c55e'; // green-500
    } else {
      dot.classList.add('hidden');
    }
  }
}

