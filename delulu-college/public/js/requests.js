document.addEventListener('DOMContentLoaded', async () => {
  await requireAuth();
  
  loadRequests('incoming');

  // Refresh when the tab becomes visible.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadRequests(document.getElementById('tab-req-incoming').classList.contains('text-primary') ? 'incoming' : 'sent');
    }
  });
  
  document.getElementById('tab-req-incoming').onclick = () => {
    document.getElementById('tab-req-incoming').classList.replace('text-on-surface-variant', 'text-primary');
    document.getElementById('tab-req-incoming').classList.add('border-b-2', 'border-primary');
    document.getElementById('tab-req-sent').classList.replace('text-primary', 'text-on-surface-variant');
    document.getElementById('tab-req-sent').classList.remove('border-b-2', 'border-primary');
    loadRequests('incoming');
  };
  document.getElementById('tab-req-sent').onclick = () => {
    document.getElementById('tab-req-sent').classList.replace('text-on-surface-variant', 'text-primary');
    document.getElementById('tab-req-sent').classList.add('border-b-2', 'border-primary');
    document.getElementById('tab-req-incoming').classList.replace('text-primary', 'text-on-surface-variant');
    document.getElementById('tab-req-incoming').classList.remove('border-b-2', 'border-primary');
    loadRequests('sent');
  };
});

let _requestsLoading = false;
let _pendingReloadType = null; // tab clicked while a load was in flight

function renderRequestItem(r, type) {
  const isIncoming = type === 'incoming';
  return `
    <div class="glass-panel p-4 rounded-2xl flex items-center justify-between gap-3 shadow-sm border border-outline-variant/20">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="w-12 h-12 rounded-full bg-primary-container text-white font-bold flex items-center justify-center overflow-hidden shrink-0 border border-outline-variant/30">
          ${getAvatarHtml(r.username, r.avatar, { className: 'w-full h-full object-cover' })}
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="font-bold text-on-surface text-base capitalize truncate">${escapeHtml(r.username)}</h3>
          <p class="text-xs text-on-surface-variant line-clamp-1 font-medium">${escapeHtml(r.bio || 'Classmate on Delulu')}</p>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        ${isIncoming ? `
          <button data-action="accept" data-id="${r.id}" class="px-4 py-2 btn-primary rounded-full text-xs font-bold shadow-sm" aria-label="Accept Request">Accept</button>
          <button data-action="reject" data-id="${r.id}" class="px-3 py-2 btn-secondary rounded-full text-xs font-bold" aria-label="Decline Request">Decline</button>
        ` : `
          <button data-action="revoke" data-id="${r.id}" class="px-3.5 py-2 btn-ghost text-error rounded-full text-xs font-bold hover:bg-error/10" aria-label="Revoke Request">Cancel</button>
        `}
      </div>
    </div>
  `;
}

function bindRequestActions() {
  const list = document.getElementById('requests-list');
  if (!list) return;
  list.querySelectorAll('button[data-action]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'accept' || action === 'reject') {
        window.respondReq(id, action);
      } else if (action === 'revoke') {
        window.revokeReq(id);
      }
    };
  });
}

async function loadRequests(type = 'incoming') {
  if (_requestsLoading) {
    // A different tab was clicked mid-flight: remember it and reload that tab
    // as soon as the current load finishes, instead of silently no-oping.
    _pendingReloadType = type;
    return;
  }
  _requestsLoading = true;
  const list = document.getElementById('requests-list');

  // Instant zero-latency render from local storage cache (eliminates waiting delay)
  let hasCache = false;
  try {
    const cached = localStorage.getItem(`cached_requests_${type}`);
    if (cached) {
      const cachedReqs = JSON.parse(cached);
      if (cachedReqs.length > 0) {
        hasCache = true;
        list.innerHTML = cachedReqs.map(r => renderRequestItem(r, type)).join('');
        bindRequestActions();
      }
    }
  } catch (e) {}

  if (!hasCache) {
    list.innerHTML = '<div class="p-4 text-center text-on-surface-variant animate-pulse">Loading requests...</div>';
  }

  try {
    const data = await apiCall(`/api/connections/${type}`);
    const reqs = data.requests;

    try {
      localStorage.setItem(`cached_requests_${type}`, JSON.stringify(reqs || []));
    } catch (e) {}

    if (!reqs || reqs.length === 0) {
      list.innerHTML = `<div class="p-8 text-center text-on-surface-variant flex flex-col items-center"><span class="material-symbols-outlined text-4xl mb-2">inbox</span> No ${type} requests.</div>`;
      return;
    }

    list.innerHTML = reqs.map(r => renderRequestItem(r, type)).join('');
    bindRequestActions();
  } catch (err) {
    list.innerHTML = `<div class="p-4 text-error">${escapeHtml(err.message)}</div>`;
  } finally {
    _requestsLoading = false;
    // Serve the tab the user clicked while this load was running.
    if (_pendingReloadType && _pendingReloadType !== type) {
      const next = _pendingReloadType;
      _pendingReloadType = null;
      loadRequests(next);
    } else {
      _pendingReloadType = null;
    }
  }
}

window.respondReq = async (id, action) => {
  // Optimistic UI update: animate and remove request card immediately
  const btn = document.querySelector(`[data-id="${id}"][data-action="${action}"]`);
  const card = btn ? btn.closest('.glass-panel') : null;
  if (card) {
    card.style.transition = 'opacity 180ms ease, transform 180ms ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';
    setTimeout(() => { if (card.parentNode) card.remove(); }, 180);
  }

  if (action === 'accept') {
    showToast('Accepted! Opening chat...', 'success');
  } else {
    showToast('Request declined');
  }

  try {
    await apiCall('/api/connections/respond', 'POST', { connection_id: id, action });
    if (action === 'accept') {
      window.location.href = `chat.html?id=${id}`;
    }
  } catch (err) {
    // Graceful Rollback: restore requests list state on server error
    showToast(`Failed to ${action} request: ${err.message}`, 'error');
    loadRequests('incoming');
  }
};

window.revokeReq = async (id) => {
  // Optimistic UI update: animate and remove card immediately
  const btn = document.querySelector(`[data-id="${id}"][data-action="revoke"]`);
  const card = btn ? btn.closest('.glass-panel') : null;
  if (card) {
    card.style.transition = 'opacity 180ms ease, transform 180ms ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';
    setTimeout(() => { if (card.parentNode) card.remove(); }, 180);
  }

  try {
    await apiCall(`/api/connections/${id}`, 'DELETE');
    showToast('Request cancelled');
  } catch (err) {
    // Graceful Rollback: restore list state on failure
    showToast(`Failed to cancel request: ${err.message}`, 'error');
    loadRequests('sent');
  }
};
