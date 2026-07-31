let discoverProfiles = [];
let currentIndex = 0;
let navTimeout = null;
let discoveryLoading = false;
let lastDiscoveryLoadAt = 0;
let userHasActiveChat = false;
let activeGenderFilter = localStorage.getItem('delulu_discover_gender_filter') || 'all';

// Pagination state
let discoverPage = 1;
let discoverHasMore = false;
let discoverTotalCount = 0;
let discoverAllLoaded = false;
const DISCOVER_PAGE_SIZE = 15;

document.addEventListener('DOMContentLoaded', async () => {
  await requireAuth();
  await loadDiscovery();
  
  // Listen for match celebration from socket
  if (socket) {
    socket.on('match-celebration', ({ connectionId, username }) => {
      showMatchCelebration(username, connectionId);
    });
  }
  
  // Scroll buttons for 3D scene
  document.getElementById('btn-scroll-left').onclick = () => navigateCards(-1);
  document.getElementById('btn-scroll-right').onclick = () => navigateCards(1);

  // Connect button for 3D scene
  const dismissBtn = document.getElementById('btn-discover-dismiss');
  if (dismissBtn) {
    dismissBtn.onclick = () => handleDismissCenter();
  }
  document.getElementById('btn-discover-connect').onclick = () => handleConnectCenter();

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') navigateCards(-1);
    if (e.key === 'ArrowRight') navigateCards(1);
  });

  // Auto-refresh when tab becomes visible — use a long cooldown so
  // switching back from APK / other tabs does NOT reset the card deck.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadDiscovery({ skipRecent: true, preserveIndex: true });
    }
  });

  // Restore saved gender filter pill on page load
  applyGenderFilterUI(activeGenderFilter);

  // Gender filter pill buttons
  const btnAll = document.getElementById('filter-all');
  if (btnAll) btnAll.onclick = () => setGenderFilter('all');
  const btnMale = document.getElementById('filter-male');
  if (btnMale) btnMale.onclick = () => setGenderFilter('male');
  const btnFemale = document.getElementById('filter-female');
  if (btnFemale) btnFemale.onclick = () => setGenderFilter('female');

  // Empty state refresh button
  const refreshBtn = document.getElementById('btn-discover-refresh');
  if (refreshBtn) refreshBtn.onclick = () => loadDiscovery();

  // Smooth scroll wheel/trackpad navigation (debounced vertical scrolling mapped to swiping)
  let lastScrollTime = 0;
  const scrollCooldown = 280; // ms between card swiping transitions
  
  window.addEventListener('wheel', (e) => {
    if (!discoverProfiles.length) return;
    
    // Catch significant vertical scrolls
    if (Math.abs(e.deltaY) > 15) {
      e.preventDefault(); // Stop default vertical scroll repaints
      
      const now = Date.now();
      if (now - lastScrollTime > scrollCooldown) {
        lastScrollTime = now;
        const direction = e.deltaY > 0 ? 1 : -1;
        navigateCards(direction);
      }
    }
  }, { passive: false });
});

// ── Gender Filter ────────────────────────────────────────────────────────────

function applyGenderFilterUI(filter) {
  const filters = { all: '#filter-all', male: '#filter-male', female: '#filter-female' };
  Object.entries(filters).forEach(([key, sel]) => {
    const btn = document.querySelector(sel);
    if (!btn) return;
    const isActive = key === filter;
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    if (isActive) {
      btn.className = 'discover-filter-btn px-4.5 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 bg-primary text-white border-primary shadow-md cursor-pointer scale-105';
    } else {
      btn.className = 'discover-filter-btn px-4 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 bg-surface-container-lowest/80 backdrop-blur-md text-on-surface-variant border-outline-variant/40 hover:border-primary/40 hover:text-primary cursor-pointer';
    }
  });
}

function setGenderFilter(filter) {
  if (activeGenderFilter === filter) return; // already selected — no-op
  activeGenderFilter = filter;
  try { localStorage.setItem('delulu_discover_gender_filter', filter); } catch (e) {}
  applyGenderFilterUI(filter);
  // Invalidate cache so the new filter is not suppressed by skipRecent cooldown
  lastDiscoveryLoadAt = 0;
  // Clear stale cached profiles so we don't flash old gender data
  try {
    sessionStorage.removeItem('discover_profiles');
    localStorage.removeItem('discover_profiles');
  } catch (e) {}
  discoverProfiles = [];
  currentIndex = 0;
  // Reset pagination state
  discoverPage = 1;
  discoverHasMore = false;
  discoverTotalCount = 0;
  discoverAllLoaded = false;
  showLoadMoreButton();
  loadDiscovery();
}

window.setGenderFilter = setGenderFilter;
window.applyGenderFilterUI = applyGenderFilterUI;

async function handleDismissCenter() {
  if (typeof window.getCurrentIndex === 'function') {
    currentIndex = window.getCurrentIndex();
  }
  const profile = discoverProfiles[currentIndex];
  const idx = currentIndex;
  if (!profile) return;
  
  // Optimistic UI update: immediately advance card stack for zero-latency feedback
  removeProfileAt(idx);
  hapticLight();
  showUndoToast('Profile dismissed', () => {
    discoverProfiles.splice(idx, 0, profile);
    currentIndex = idx;
    init3DScene();
  }, 3000);

  try {
    await apiCall('/api/connections/dismiss', 'POST', { to_user_id: profile.id });
  } catch (err) {
    // Rollback: restore profile card if server request fails
    discoverProfiles.splice(idx, 0, profile);
    currentIndex = idx;
    init3DScene();
    showToast(`Failed to dismiss profile: ${err.message}`, 'error');
  }
}

async function handleConnectCenter() {
  if (typeof window.getCurrentIndex === 'function') {
    currentIndex = window.getCurrentIndex();
  }
  const profile = discoverProfiles[currentIndex];
  const idx = currentIndex;
  if (!profile) return;
  
  if (userHasActiveChat) {
    showToast("You are currently in an active 10-day chat! Finish your current chat or tap 'Not Vibing' before connecting with someone new.", 'error');
    return;
  }

  // Optimistic UI update: advance card deck & show toast immediately
  hapticMedium();
  removeProfileAt(idx);
  showToast('Connection request sent!');

  try {
    await apiCall('/api/connections/request', 'POST', { to_user_id: profile.id });
  } catch (err) {
    // Rollback: restore profile card to stack if connection request fails
    discoverProfiles.splice(idx, 0, profile);
    currentIndex = idx;
    init3DScene();
    showToast(`Failed to send connection: ${err.message}`, 'error');
  }
}

function removeProfileAt(index) {
  discoverProfiles.splice(index, 1);
  checkEmptyState();
  
  if (discoverProfiles.length > 0) {
    // Re-initialize 3D scene with the updated profile list
    if (typeof initAvatarScene === 'function') {
      initAvatarScene('avatar-3d-container', discoverProfiles);
      // Snap back to nearest index
      currentIndex = Math.min(index, discoverProfiles.length - 1);
      window.updateAvatarScene(currentIndex);
    }
    // Update nav buttons + "View More" button visibility
    updateNavButtons();
  } else {
    // Empty state
    if (typeof destroyAvatarScene === 'function') {
      destroyAvatarScene();
    }
  }
}

function navigateCards(dir) {
  if (!discoverProfiles.length) return;
  
  currentIndex += dir;
  if (currentIndex < 0) currentIndex = 0;
  if (currentIndex >= discoverProfiles.length) currentIndex = discoverProfiles.length - 1;
  
  // Update scene via scroll simulation
  const scene = document.getElementById('avatar-3d-container');
  if (scene && window.updateAvatarScene) {
    window.updateAvatarScene(currentIndex);
  }
  
  updateProfileOverlay(currentIndex);
  updateNavButtons();
  checkEmptyState();
}

function updateNavButtons() {
  const leftButton = document.getElementById('btn-scroll-left');
  const rightButton = document.getElementById('btn-scroll-right');
  const isAtFirstCard = currentIndex <= 0;
  const isAtLastCard = discoverProfiles.length > 0 && currentIndex >= discoverProfiles.length - 1;

  if (leftButton) {
    leftButton.style.opacity = isAtFirstCard ? '0.3' : '1';
    leftButton.style.pointerEvents = isAtFirstCard ? 'none' : 'auto';
    leftButton.disabled = isAtFirstCard;
  }

  if (rightButton) {
    // At a page boundary, View more takes the next arrow's place.
    rightButton.classList.toggle('hidden', isAtLastCard && discoverHasMore);
    rightButton.style.opacity = isAtLastCard ? '0.3' : '1';
    rightButton.style.pointerEvents = isAtLastCard ? 'none' : 'auto';
    rightButton.disabled = isAtLastCard;
  }

  showLoadMoreButton();
}

function updateProfileOverlay(index) {
  const p = discoverProfiles[index];
  if (!p) return;
  
  const overlay = document.getElementById('center-profile-info');
  if (!overlay) return;
  
  document.getElementById('center-username').textContent = p.username;
  document.getElementById('center-bio').textContent = p.bio || 'Mystery person...';
  
  const hobbiesEl = document.getElementById('center-hobbies');
  if (p.hobbies && p.hobbies.length > 0) {
    // Limit to max 4 hobbies on mobile to prevent layout overflow
    const displayHobbies = window.innerWidth < 768 ? p.hobbies.slice(0, 4) : p.hobbies;
    hobbiesEl.innerHTML = displayHobbies.map(h => 
      `<span class="px-3 py-1 bg-white/40 backdrop-blur-md rounded-full text-xs font-semibold text-on-surface-variant border border-white/50 shadow-sm">${escapeHtml(h)}</span>`
    ).join('');
  } else {
    hobbiesEl.innerHTML = '';
  }
}


async function loadDiscovery(options = {}) {
  if (discoveryLoading) return;
  if (options.skipRecent && Date.now() - lastDiscoveryLoadAt < 60000) return;
  // A visibility refresh must never collapse a deck that the user has paged through.
  if (options.preserveIndex && discoverProfiles.length > 0) return;

  // Instant zero-latency render from local cache (eliminates skeleton waiting time)
  if (!discoverProfiles.length) {
    try {
      const cached = sessionStorage.getItem('discover_profiles') || localStorage.getItem('discover_profiles');
      if (cached) {
        discoverProfiles = JSON.parse(cached);
        if (discoverProfiles.length > 0) {
          const overlay = document.getElementById('profile-overlay');
          if (overlay) overlay.classList.remove('hidden');
          updateProfileOverlay(0);
          updateNavButtons();
          init3DScene();
        }
      }
    } catch (e) {}
  }

  discoveryLoading = true;
  try {
    // Build URL with optional gender filter and pagination params
    const pageToLoad = options.page || (options.append ? discoverPage + 1 : 1);
    const profileCountBeforeAppend = discoverProfiles.length;
    const genderParam = (activeGenderFilter && activeGenderFilter !== 'all')
      ? `?gender=${activeGenderFilter}&page=${pageToLoad}&limit=${DISCOVER_PAGE_SIZE}`
      : `?page=${pageToLoad}&limit=${DISCOVER_PAGE_SIZE}`;
    const data = await apiCall(`/api/discover${genderParam}`);
    lastDiscoveryLoadAt = Date.now();
    userHasActiveChat = !!data.hasActiveConnection; // Sync active connection status from server
    
    discoverPage = data.page || pageToLoad;
    discoverHasMore = data.hasMore;
    discoverTotalCount = data.totalCount || 0;
    discoverAllLoaded = false; // Reset on every successful fetch
    
    const newProfiles = data.profiles || [];
    
    let appendedProfileCount = 0;
    if (options.append && discoverProfiles.length > 0) {
      // Append mode: deduplicate and add to existing deck
      const existingIds = new Set(discoverProfiles.map(p => p.id));
      const freshProfiles = newProfiles.filter(p => !existingIds.has(p.id));
      if (freshProfiles.length > 0) {
        discoverProfiles.push(...freshProfiles);
        appendedProfileCount = freshProfiles.length;
      }
    } else {
      // Normal mode: replace entire deck
      discoverProfiles = newProfiles;
    }
    
    // Cache profiles for instant zero-latency loading
    try {
      sessionStorage.setItem('discover_profiles', JSON.stringify(discoverProfiles));
      localStorage.setItem('discover_profiles', JSON.stringify(discoverProfiles));
    } catch (e) {}

    // Show/hide Load More button
    showLoadMoreButton();
    
    // Show profile overlay immediately
    if (discoverProfiles.length > 0) {
      const overlay = document.getElementById('profile-overlay');
      if (overlay) overlay.classList.remove('hidden');

      // Loading another page starts at the first new person, never at profile one.
      if (options.append && options.focusFirstNew && appendedProfileCount > 0) {
        currentIndex = profileCountBeforeAppend;
        updateProfileOverlay(currentIndex);
      } else if (options.preserveIndex && currentIndex > 0 && currentIndex < discoverProfiles.length) {
        updateProfileOverlay(currentIndex);
      } else if (!options.append) {
        currentIndex = 0;
        updateProfileOverlay(0);
      }
      updateNavButtons();
    }
    
    init3DScene();
  } catch (err) {
    console.error(err);
    // Re-throw on append so loadMoreDiscover's catch can restore the UI
    if (options.append) throw err;
  } finally {
    discoveryLoading = false;
  }
}

function init3DScene() {
  checkEmptyState();
  if (!discoverProfiles || discoverProfiles.length === 0) return;
  
  const container = document.getElementById('avatar-3d-container');
  if (!container) return;
  
  if (typeof initAvatarScene === 'function') {
    // Clamp currentIndex in case the profile list shrank
    const safeIdx = Math.min(currentIndex, discoverProfiles.length - 1);
    currentIndex = safeIdx;
    initAvatarScene('avatar-3d-container', discoverProfiles);
    window.updateAvatarScene(safeIdx);
  } else {
    renderFallbackCards();
  }
}

// ===== Match Celebration =====
function showMatchCelebration(username, connectionId) {
  hapticHeavy();
  
  const overlay = document.createElement('div');
  overlay.className = 'match-celebration';
  overlay.onclick = () => overlay.remove();
  
  // Create confetti
  // ponytail: 60 DOM confetti pieces + per-piece inline styles. Replace with CSS @keyframes confetti when perf matters.
  const colors = ['#a53b29', '#ff7e67', '#fdd4c0', '#ffb4a6', '#ffdad4', '#ffdbca'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (4 + Math.random() * 8) + 'px';
    piece.style.height = (4 + Math.random() * 8) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.setProperty('--fall-duration', (2 + Math.random() * 3) + 's');
    piece.style.setProperty('--fall-delay', Math.random() * 2 + 's');
    overlay.appendChild(piece);
  }
  
  const card = document.createElement('div');
  card.className = 'match-card';
  card.innerHTML = `
    <span class="material-symbols-outlined text-[64px] text-white material-fill animate-pulse">handshake</span>
    <div class="match-title">New Connection!</div>
    <div class="match-subtitle">You and <strong>${escapeHtml(username)}</strong> want to connect!</div>
    <div style="margin-top: 24px;">
      <button style="background: rgba(255,255,255,0.2); border: 2px solid rgba(255,255,255,0.4); color: white; padding: 12px 32px; border-radius: 16px; font-weight: bold; font-size: 1rem; cursor: pointer;">
        Start Chatting
      </button>
    </div>
  `;
  const chatBtn = card.querySelector('button');
  if (chatBtn) {
    chatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.href = `chat.html?id=${connectionId}`;
    });
  }
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  
  setTimeout(() => {
    if (overlay.parentNode) {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }
  }, 8000);
}

window.showMatchCelebration = showMatchCelebration;

function renderFallbackCards() {
  const container = document.getElementById('avatar-3d-container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="w-full h-full flex items-center justify-center overflow-x-auto snap-x snap-mandatory gap-6 px-8" id="fallback-rail">
      ${discoverProfiles.map((p, i) => {
        const safeUsername = escapeHtml(p.username);
        const safeBio = escapeHtml(p.bio || 'Mystery person...');
        const hobbyChips = (p.hobbies || []).slice(0, 3).map(h => 
          `<span class="px-2 py-0.5 bg-surface-container-high/60 rounded-full text-[10px]">${escapeHtml(h)}</span>`
        ).join('');
        return `
          <div class="discover-card relative w-64 h-[420px] shrink-0 snap-center flex flex-col items-center justify-center bg-white/60 backdrop-blur-xl rounded-3xl shadow-xl border border-white/40 p-4 transition-all duration-300" id="fallback-card-${i}">
            <div class="w-40 h-40 rounded-2xl overflow-hidden shadow-lg mb-3 avatar-img-wrapper transition-all duration-300 ${i === 0 ? 'animate-hello' : ''}">
              ${getAvatarHtml(p.username, p.avatar)}
            </div>
            <h3 class="font-bold text-xl capitalize text-on-surface">${safeUsername}</h3>
            <p class="text-xs text-on-surface-variant mt-1 line-clamp-2 text-center">${safeBio}</p>
            <div class="flex flex-wrap gap-1 justify-center mt-2 mb-3">
              ${hobbyChips}
            </div>
            <div class="flex gap-3 mt-auto">
              <button data-fallback-action="dismiss" data-index="${i}" class="w-10 h-10 rounded-full bg-white shadow-md border border-outline-variant/20 flex items-center justify-center text-on-surface-variant hover:scale-110 transition-all">
                <span class="material-symbols-outlined">close</span>
              </button>
              <button data-fallback-action="connect" data-index="${i}" class="px-5 py-2 rounded-full bg-gradient-to-r from-primary to-primary-container text-white text-sm font-bold shadow-md hover:scale-105 transition-all">
                <span class="material-symbols-outlined text-sm material-fill">favorite</span> Connect
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Bind fallback card events programmatically to prevent adblock/security policy blocking
  container.querySelectorAll('[data-fallback-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const action = btn.getAttribute('data-fallback-action');
      const idx = Number(btn.getAttribute('data-index'));
      if (action === 'dismiss') {
        dismissFallback(idx);
      } else if (action === 'connect') {
        connectFallback(idx, btn);
      }
    });
  });
}

function checkEmptyState() {
  const container = document.getElementById('avatar-3d-container');
  const empty = document.getElementById('discovery-empty');
  const overlay = document.getElementById('profile-overlay');
  const navBtns = document.getElementById('btn-scroll-left');
  
  if (!discoverProfiles || discoverProfiles.length === 0) {
    if (container) container.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
    if (navBtns && navBtns.parentElement) navBtns.parentElement.classList.add('hidden');
    if (empty) {
      empty.classList.remove('hidden');
      empty.classList.add('flex');
    }
  } else {
    if (container) container.classList.remove('hidden');
    if (navBtns && navBtns.parentElement) navBtns.parentElement.classList.remove('hidden');
    if (empty) {
      empty.classList.add('hidden');
      empty.classList.remove('flex');
    }
  }
}

// Fallback dismiss
window.dismissFallback = (index) => {
  const card = document.getElementById(`fallback-card-${index}`);
  if (card) {
    card.style.transform = 'scale(0.5) rotateY(-20deg)';
    card.style.opacity = '0';
    setTimeout(() => {
      discoverProfiles.splice(index, 1);
      renderFallbackCards();
      checkEmptyState();
    }, 300);
  }
};

// Fallback connect
window.connectFallback = async (index, btn) => {
  const profile = discoverProfiles[index];
  if (!profile) return;
  
  btn.disabled = true;
  btn.textContent = 'Sending...';
  
  try {
    await apiCall('/api/connections/request', 'POST', { to_user_id: profile.id });
    discoverProfiles.splice(index, 1);
    renderFallbackCards();
    checkEmptyState();
  } catch (err) {
    showToast(err.message, 'error');
    btn.textContent = 'Connect';
    btn.disabled = false;
  }
};

// ── Pagination: Load More ────────────────────────────────────────────────────
function showDiscoverSkeletons(count = 6) {
  const container = document.getElementById('avatar-3d-container');
  if (!container) return;
  // Destroy 3D scene so skeletons replace it cleanly
  if (typeof destroyAvatarScene === 'function') destroyAvatarScene();
  
  const cards = Array.from({ length: count }, () => `
    <div class="discover-skeleton-card">
      <div class="discover-skeleton-avatar shimmer-block"></div>
      <div class="discover-skeleton-line shimmer-block" style="width:65%"></div>
      <div class="discover-skeleton-line shimmer-block" style="width:85%"></div>
      <div class="discover-skeleton-line short shimmer-block"></div>
      <div class="flex gap-2 justify-center mt-4">
        <div class="discover-skeleton-chip shimmer-block"></div>
        <div class="discover-skeleton-chip shimmer-block"></div>
        <div class="discover-skeleton-chip shimmer-block"></div>
      </div>
    </div>
  `).join('');
  
  container.innerHTML = `<div class="discover-skeleton-rail">${cards}</div>`;
  container.classList.remove('hidden');
}

function showLoadMoreButton() {
  const btn = document.getElementById('btn-load-more');
  if (!btn) return;
  // Only offer another page at the end of the current deck when one exists.
  const isAtLastCard = discoverProfiles.length > 0 && currentIndex >= discoverProfiles.length - 1;
  const shouldShow = isAtLastCard && discoverHasMore && !discoverAllLoaded;
  btn.classList.toggle('hidden', !shouldShow);
  btn.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
}

window.loadMoreDiscover = async function () {
  if (discoveryLoading) return;
  
  // If server says there are no more profiles, show a friendly message
  if (!discoverHasMore) {
    if (window.showToast) {
      showToast('No more profiles to show', 'info');
    }
    discoverAllLoaded = true;
    const btn = document.getElementById('btn-load-more');
    if (btn) btn.classList.add('hidden');
    return;
  }
  
  // Show shimmer skeleton cards while loading
  showDiscoverSkeletons(6);
  // Show loading state on button
  const btn = document.getElementById('btn-load-more');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span> Loading...';
  }
  
  try {
    await loadDiscovery({ append: true, focusFirstNew: true });
  } catch (err) {
    // API failure — restore the previous scene and button.
    console.error('Load more failed, restoring UI:', err);
    if (discoverProfiles && discoverProfiles.length > 0) {
      init3DScene();
    }
    if (window.showToast) {
      showToast('Failed to load more profiles', 'error');
    }
  } finally {
    // Always restore button to ready state
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-lg">expand_more</span> View More';
    }
  }
};

// Expose for avatar3d.js to call
window.getDiscoverProfiles = () => discoverProfiles;
window.updateProfileOverlay = updateProfileOverlay;
window.updateNavButtons = updateNavButtons;
window.getCurrentIndex = () => currentIndex;
window.setCurrentIndex = (idx) => { currentIndex = idx; };
window.removeProfile = (id) => {
  discoverProfiles = discoverProfiles.filter(p => p.id !== id);
  checkEmptyState();
};
