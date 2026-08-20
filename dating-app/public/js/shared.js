const isCapacitorNative = typeof window !== 'undefined' && (
  (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
  (window.Capacitor && window.Capacitor.isPluginAvailable) ||
  window.location.protocol === 'capacitor:' || 
  window.location.protocol === 'ionic:' || 
  window.location.href.startsWith('capacitor://') ||
  window.location.href.startsWith('ionic://')
);

const isLocalEnv = !isCapacitorNative && typeof window !== 'undefined' && (
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.')) &&
  (window.location.port === '3000' || window.location.port === '5000' || window.location.port === '8080')
);

// ===== Debug logging gate =====
// Production builds must not log sensitive client state (SSE lifecycle, E2EE
// status, connection ids, active user). Debug output only runs when explicitly
// enabled with ?debug=1 on the URL or window.__DELULU_DEBUG=true (dev console).
const DEBUG_LOGGING = typeof window !== 'undefined' && (
  (typeof window.__DELULU_DEBUG === 'boolean' && window.__DELULU_DEBUG) ||
  (typeof window.location !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1')
);

function dbg(...args) {
  if (!DEBUG_LOGGING) return;
  console.log(...args);
}

function dbgWarn(...args) {
  if (!DEBUG_LOGGING) return;
  console.warn(...args);
}
// API base URL — single source of truth is capacitor.config.json → plugins.Config.apiBaseUrl.
// Falls back to the hardcoded Railway URL if the Capacitor config is unavailable (e.g. plain web).
const _FALLBACK_API = 'https://delulu-app-main-production.up.railway.app';
const API_BASE = isLocalEnv
  ? window.location.origin
  : (window.Capacitor?.config?.plugins?.Config?.apiBaseUrl || _FALLBACK_API);
function resolveUrl(url) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  return `${API_BASE}${cleanUrl}`;
}

// ===== Secure auth-token storage =====
// Web: the session is carried entirely by the server's httpOnly Secure SameSite=Lax
// cookie — no auth token is ever written to window.localStorage on web.
// Android (Capacitor): the revocable HMAC token lives in native secure storage
const AUTH_TOKEN_KEY = 'auth_token';
let _inMemoryAuthToken = null;
let _authTokenFetchPromise = null;

function getCapacitorPreferences() {
  if (!isCapacitorNative || typeof window === 'undefined' || !window.Capacitor) return null;
  return window.Capacitor.Plugins?.Preferences || window.Capacitor.Preferences || null;
}

async function getStoredAuthToken() {
  if (_inMemoryAuthToken) return _inMemoryAuthToken;
  const prefs = getCapacitorPreferences();
  if (prefs) {
    if (_authTokenFetchPromise) return _authTokenFetchPromise;
    _authTokenFetchPromise = (async () => {
      try {
        const { value } = await prefs.get({ key: AUTH_TOKEN_KEY });
        _inMemoryAuthToken = value || null;
        return _inMemoryAuthToken;
      } catch (e) { return null; }
      finally { _authTokenFetchPromise = null; }
    })();
    return _authTokenFetchPromise;
  }
  return null; // web: cookie-only auth, token deliberately never stored
}

async function setStoredAuthToken(token) {
  _inMemoryAuthToken = token || null;
  if (!token) {
    await removeStoredAuthToken();
    return;
  }
  const prefs = getCapacitorPreferences();
  if (prefs) {
    try {
      await prefs.set({ key: AUTH_TOKEN_KEY, value: token });
    } catch (e) {}
  }
}

async function removeStoredAuthToken() {
  _inMemoryAuthToken = null;
  const prefs = getCapacitorPreferences();
  if (prefs) {
    try {
      await prefs.remove({ key: AUTH_TOKEN_KEY });
    } catch (e) {}
  }
  window.localStorage.removeItem(AUTH_TOKEN_KEY); // purge legacy value from old builds
}

// One-time migration: remove any legacy auth_token from localStorage.
// On Android it is moved into native Capacitor storage first; on web it is
// simply deleted (the httpOnly cookie is the only credential).
(async function migrateLegacyAuthToken() {
  try {
    const legacy = window.localStorage.getItem(AUTH_TOKEN_KEY);
    if (legacy) {
      const prefs = getCapacitorPreferences();
      if (prefs) {
        await prefs.set({ key: AUTH_TOKEN_KEY, value: legacy });
      }
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch (e) {}
})();

let currentUser = null;
// Real-time delivery uses SSE exclusively. There is deliberately no WebSocket
// fallback or client shim: adding one would create a second event pipeline.
const socket = null;

// Global client error logger to diagnose browser-specific issues
window.onerror = function (msg, src, line, col, err) {
  fetch(resolveUrl('/api/log-error'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: isCapacitorNative ? 'omit' : 'include',
    body: JSON.stringify({ message: msg, source: src, lineno: line, colno: col, stack: err ? err.stack : '', path: window.location.href })
  }).catch(() => {});
};

window.addEventListener('unhandledrejection', (event) => {
  fetch(resolveUrl('/api/log-error'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: isCapacitorNative ? 'omit' : 'include',
    body: JSON.stringify({ message: event.reason ? event.reason.message : 'Unhandled Rejection', stack: event.reason ? event.reason.stack : '', path: window.location.href })
  }).catch(() => {});
});

// Escape HTML to prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Password strength (mirrors the server policy in server.js) =====
// Client-side mirror catches weak passwords before submission so the user gets
// instant feedback; the server re-validates authoritatively (incl. the
// HaveIBeenPwned check) and can never be bypassed from the browser.
const MIN_PASSWORD_LENGTH = 12;
const COMMON_WEAK_PASSWORDS = [
  '123456','password','12345678','qwerty','123456789','12345','1234567','password1',
  '1234567890','123123','abc123','iloveyou','letmein','admin','welcome','monkey',
  'dragon','master','111111','000000','1234','qwerty123','sunshine','princess',
  'football','baseball','superman','trustno1','delulu','delulu123','college123',
  'password123456','qwerty123456','123456789012'
];

function getPasswordStrengthError(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (COMMON_WEAK_PASSWORDS.includes(password.toLowerCase().trim())) {
    return 'This password is too common. Please choose a stronger password.';
  }
  return null;
}

// Generated from config/profanity.json and loaded before this file. Keeping the
// browser pre-encryption filter on the same source as the server is essential:
// encrypted payloads cannot be moderated after they leave the device.
const FORBIDDEN_WORDS = window.DELULU_PROFANITY.forbiddenWords;
const FORBIDDEN_SHORT_TOKENS = window.DELULU_PROFANITY.forbiddenShortTokens;

// Pre-compiled word-boundary patterns (built once at load — no per-message overhead)
const SHORT_TOKEN_PATTERNS = FORBIDDEN_SHORT_TOKENS.map(token => new RegExp(`\\b${token}\\b`));

const FORBIDDEN_MESSAGE_ERROR = 'This message contains words that are not allowed. Please rephrase.';

function findForbiddenText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lower = text.toLowerCase();
  // Tier 1: full abusive words — substring match (catches embedded variants)
  for (const word of FORBIDDEN_WORDS) {
    if (lower.includes(word)) return word;
  }
  // Tier 2: short letter combos — standalone word only (word-boundary match)
  for (let i = 0; i < SHORT_TOKEN_PATTERNS.length; i++) {
    if (SHORT_TOKEN_PATTERNS[i].test(lower)) return FORBIDDEN_SHORT_TOKENS[i];
  }
  return null;
}

function hasForbiddenText(text) {
  return findForbiddenText(text) !== null;
}

// Ensure we have user data on protected routes (Optimistic Session Cache)
// Web: authenticated via the server's httpOnly Secure SameSite=Lax cookie — no
// token in localStorage. For Capacitor APK: session cookies don't persist from
// the file:///capacitor:// origin, so the revocable HMAC token is read from
// native Capacitor storage (@capacitor/preferences) and sent as Authorization.
//
// Session Verification Cache: after a successful /api/session confirmation, we
// record the timestamp in localStorage. For 5 minutes after that, we skip the
// background network check entirely — the page renders instantly from the cached
// user with no round-trip. This eliminates the race condition where rapid
// page-to-page navigation fires multiple overlapping /api/session requests on
// Railway cold-start and the retry logic incorrectly triggers sign-out.
const SESSION_VERIFIED_KEY = 'session_verified_at';
const SESSION_VERIFY_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isSessionRecentlyVerified() {
  try {
    const t = Number(window.localStorage.getItem(SESSION_VERIFIED_KEY));
    return t && (Date.now() - t) < SESSION_VERIFY_TTL_MS;
  } catch (e) { return false; }
}

function markSessionVerified() {
  try { window.localStorage.setItem(SESSION_VERIFIED_KEY, String(Date.now())); } catch (e) {}
}

async function requireAuth() {
  const cachedUserStr = window.localStorage.getItem('cached_user');
  
  if (cachedUserStr) {
    try {
      currentUser = JSON.parse(cachedUserStr);
      updateHeaderAvatar();
      initPushNotifications();
      initGlobalUserStream();

      // If we verified the session recently, skip the network round-trip entirely.
      if (isSessionRecentlyVerified()) {
        return; // Session is still fresh — render immediately, no network needed
      }

      // Perform session verification in background (non-blocking — page renders immediately with cached data).
      const safeTimeout = (ms) => new Promise(resolve => setTimeout(() => resolve(null), ms));

      Promise.race([apiCall('/api/session'), safeTimeout(15000)]).then(async result => {
        if (!result) return; // Timeout or network error — keep cached data, do NOT sign out

        if (result.authenticated && result.user) {
          currentUser = result.user;
          window.localStorage.setItem('cached_user', JSON.stringify(result.user));
          if (result.token) await setStoredAuthToken(result.token);
          markSessionVerified();
          updateHeaderAvatar();
          initPushNotifications();
          initGlobalUserStream();

        } else if (result.authenticated === false) {
          if (!navigator.onLine) return; // Offline: keep cached user, do NOT redirect

          // First retry (10s)
          Promise.race([apiCall('/api/session'), safeTimeout(10000)]).then(async r1 => {
            if (!r1) return;
            if (r1.authenticated && r1.user) {
              currentUser = r1.user;
              window.localStorage.setItem('cached_user', JSON.stringify(r1.user));
              if (r1.token) await setStoredAuthToken(r1.token);
              markSessionVerified();
              updateHeaderAvatar();
              initPushNotifications();
              initGlobalUserStream();
              return;
            }
            if (!r1.authenticated) {
              if (!navigator.onLine) return;
              await new Promise(res => setTimeout(res, 2000));
              Promise.race([apiCall('/api/session'), safeTimeout(8000)]).then(async r2 => {
                if (!r2 || !navigator.onLine) return;
                if (r2.authenticated && r2.user) {
                  currentUser = r2.user;
                  window.localStorage.setItem('cached_user', JSON.stringify(r2.user));
                  if (r2.token) await setStoredAuthToken(r2.token);
                  markSessionVerified();
                  updateHeaderAvatar();
                  initPushNotifications();
                  initGlobalUserStream();
                } else if (r2.authenticated === false) {
                  window.localStorage.removeItem('cached_user');
                  window.localStorage.removeItem(SESSION_VERIFIED_KEY);
                  await removeStoredAuthToken();
                  window.localStorage.removeItem('e2ee_private_key');
                  window.location.replace('login.html');
                }
              }).catch(() => {});
            }
          }).catch(() => {});
        }
      }).catch(() => {});
      
      return;
    } catch (e) {
      window.localStorage.removeItem('cached_user');
      window.localStorage.removeItem(SESSION_VERIFIED_KEY);
      await removeStoredAuthToken();
    }
  }

  // Fallback: no cached user — must verify synchronously before showing the page
  try {
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 8000));
    const data = await Promise.race([apiCall('/api/session'), timeoutPromise]);
    
    if (data && data.authenticated && data.user) {
      currentUser = data.user;
      window.localStorage.setItem('cached_user', JSON.stringify(data.user));
      if (data.token) await setStoredAuthToken(data.token);
      markSessionVerified();
      updateHeaderAvatar();
      initPushNotifications();
      initGlobalUserStream();
    } else if (data && data.authenticated === false) {
      window.localStorage.removeItem('cached_user');
      window.localStorage.removeItem(SESSION_VERIFIED_KEY);
      await removeStoredAuthToken();
      window.location.href = 'login.html';
    } else {
      if (!window.localStorage.getItem('cached_user')) {
        window.location.href = 'login.html';
      }
    }
  } catch (err) {
    if (!window.localStorage.getItem('cached_user')) {
      window.location.href = 'login.html';
    } else {
      console.warn('Session check failed, using cached user');
    }
  }
}

function updateHeaderAvatar() {
  const avatarEl = document.getElementById('header-avatar');
  if (avatarEl && currentUser) {
    avatarEl.innerHTML = getAvatarHtml(currentUser.username, currentUser.avatar);
  }
}

let reconnectBanner = null;

function showReconnectBanner() {
  if (reconnectBanner) return;
  reconnectBanner = document.createElement('div');
  reconnectBanner.id = 'reconnect-banner';
  reconnectBanner.className = 'fixed top-0 left-0 w-full z-[9999] bg-error/90 text-white text-center text-xs font-bold py-2 px-4 backdrop-blur-sm';
  reconnectBanner.innerHTML = '<span class="material-symbols-outlined text-sm align-middle mr-1">wifi_off</span> Connection lost. Reconnecting...';
  document.body.prepend(reconnectBanner);
}

function hideReconnectBanner() {
  if (reconnectBanner) {
    reconnectBanner.remove();
    reconnectBanner = null;
  }
}

// After a password change, the E2EE private key stored on the server is
// encrypted with a key derived from the OLD password — with the new password it
// can never be decrypted again, which would permanently lock the user out of
// their chat history. This helper re-encrypts the existing private key (kept in
// localStorage after login) with the new password. If no local key exists (e.g.
// forgot-password on a fresh device), a fresh keypair is minted so future
// messages still work.
// Returns { encrypted_private_key, public_key } — merge into the reset request.
async function reencryptE2EEKeysForNewPassword(newPassword, email) {
  if (typeof E2EECrypto === 'undefined') return {};
  try {
    let privateKey = null;
    const existingKeyJwkStr = window.localStorage.getItem('e2ee_private_key');
    if (existingKeyJwkStr) {
      // Re-encrypt the existing keypair — preserves chat history.
      privateKey = await E2EECrypto.importPrivateKeyFromJwk(JSON.parse(existingKeyJwkStr));
    } else {
      // No recoverable key on this device — mint a fresh keypair so new chats work.
      const keypair = await E2EECrypto.generateECDHKeypair();
      privateKey = keypair.privateKey;
    }

    const pbkdf2Key = await E2EECrypto.deriveKeyFromPassword(newPassword, email);
    const encrypted_private_key = await E2EECrypto.encryptPrivateKey(privateKey, pbkdf2Key);

    // ALWAYS derive the matching public key from the same keypair and send it.
    // This guarantees the server's public_key always matches the stored private
    // key — even if the private key came from a previous (failed) reset attempt
    // that already wrote a fresh keypair to localStorage. Without this, a retry
    // would update passcode + encrypted_private_key while leaving the OLD
    // public_key on the server → permanent ECDH mismatch → unreadable messages.
    let public_key = null;
    try {
      public_key = await E2EECrypto.exportKeyToJwk(privateKey.publicKey);
    } catch (e) {
      // Some browsers expose the public key off the private CryptoKey; if that
      // fails, fall back to the public half of the stored JWK (contains x/y).
      const jwk = await E2EECrypto.exportKeyToJwk(privateKey);
      public_key = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
    }

    // For a freshly minted keypair, also return the raw private JWK so the
    // caller persists it to localStorage ONLY after the server confirms the
    // reset succeeded — never before, so a failed attempt can't leave a stale
    // keypair behind that mismatches the server's stored public_key.
    let privateKeyJwk = null;
    if (!existingKeyJwkStr) {
      try {
        privateKeyJwk = await E2EECrypto.exportKeyToJwk(privateKey);
      } catch (e) {
        privateKeyJwk = null;
      }
    }
    return { encrypted_private_key, public_key, privateKeyJwk };
  } catch (err) {
    console.error('Failed to re-encrypt E2EE keys after password change:', err);
    return {};
  }
}

async function apiCall(url, method = 'GET', body = null) {
  const options = { 
    method, 
    headers: { 'Content-Type': 'application/json' },
    credentials: isCapacitorNative ? 'omit' : 'include'
  };
  
  const token = await getStoredAuthToken();
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  if (body) options.body = JSON.stringify(body);

  const targetUrl = resolveUrl(url);
  let res;
  try {
    res = await fetch(targetUrl, options);
  } catch (netErr) {
    throw new Error('Network connection error. Please check your internet connection.');
  }

  let data;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (e) {
      data = { error: 'Invalid response from server' };
    }
  } else {
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      if (res.status === 404) {
        data = { error: 'API endpoint not found (404).' };
      } else if (res.status === 502 || res.status === 503 || res.status === 504) {
        data = { error: 'Server is updating or unavailable (502/503). Please try again in a moment.' };
      } else {
        data = { error: `Server error (${res.status})` };
      }
    } else {
      data = { text };
    }
  }

  if (!res.ok) {
    if (res.status === 401) {
      // Only purge credentials and redirect if the explicit session check failed
      // and we are online. Background polls/requests should not abruptly log the user out.
      if (url.includes('/api/session') && navigator.onLine) {
        window.localStorage.removeItem('cached_user');
        window.localStorage.removeItem('session_verified_at');
        await removeStoredAuthToken();
        window.localStorage.removeItem('e2ee_private_key');
        const pathname = window.location.pathname;
        if (!pathname.endsWith('login.html') && !pathname.endsWith('login')) {
          window.location.href = 'login.html';
          return new Promise(() => {});
        }
      }
    }
    const err = new Error(data?.error || `Server error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ===== Short-lived SSE access tokens =====
// EventSource cannot attach an Authorization header, and Capacitor Android has
// no session cookie — so before opening a stream the client exchanges its
// regular auth (cookie or HMAC bearer token) for a signed, 60-second,
// single-purpose stream token via /api/sse-token, then passes it as a query
// parameter. The long-lived HMAC token is never placed in a stream URL.
let _sseToken = null;
let _sseTokenExpiresAt = 0;

async function getSSEToken() {
  if (_sseToken && Date.now() < _sseTokenExpiresAt - 5000) return _sseToken;
  try {
    const data = await apiCall('/api/sse-token');
    if (data && data.token) {
      _sseToken = data.token;
      _sseTokenExpiresAt = Date.now() + (Number(data.expires_in_ms) || 60000);
      return _sseToken;
    }
  } catch (e) { /* caller retries with backoff */ }
  return null;
}

async function buildSSEUrl(path) {
  const base = resolveUrl(path);
  const token = await getSSEToken();
  if (!token) return base; // web fallback: same-origin cookies still authenticate
  return `${base}${base.includes('?') ? '&' : '?'}sse_token=${encodeURIComponent(token)}`;
}

function getAvatarHtml(username, avatar, options = {}) {
  const { className = 'prof-avatar-img', lazy = false } = options;
  const loadingAttr = lazy ? 'loading="lazy"' : '';
  const safeUsername = escapeHtml(username || '');
  if (avatar) {
    let src = '';
    if (typeof avatar === 'object' && avatar.idle) {
      src = avatar.idle;
    } else if (typeof avatar === 'string') {
      if (avatar.startsWith('/avatars/') || avatar.startsWith('http') || avatar.startsWith('data:')) {
        src = avatar;
      } else {
        const match = avatar.match(/^(male|female)_(\d+)$/);
        if (match) {
          const gender = match[1];
          const num = parseInt(match[2], 10);
          const numStr = num < 10 ? `0${num}` : `${num}`;
          src = `/avatars/${gender}/${gender}_${numStr}/idle.png`;
        } else {
          src = `/avatars/${avatar}`;
        }
      }
    }
    if (src) {
      return `<span class="avatar-circle-wrapper"><img src="${src}" alt="${safeUsername}" class="${className}" ${loadingAttr}></span>`;
    }
  }
  const initial = safeUsername ? safeUsername.charAt(0).toUpperCase() : '?';
  return `<div class="w-full h-full bg-gradient-to-br from-primary-container to-secondary-container text-white flex items-center justify-center font-bold text-3xl">${initial}</div>`;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getCountdown(targetDate) {
  const now = new Date();
  const target = new Date(targetDate);
  const diff = target - now;
  if (diff <= 0) return 'Available now';
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / 1000 / 60) % 60);
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m left`;
}

function setupLogout() {
  const btn = document.getElementById('logout-btn');
  if (btn) {
    btn.onclick = async () => {
      const deviceId = getOrCreateDeviceId();
      await apiCall(`/api/devices/${deviceId}`, 'DELETE').catch(() => {});
      window.localStorage.removeItem('cached_user');
      await removeStoredAuthToken();
      window.localStorage.removeItem('e2ee_private_key');
      await apiCall('/api/users/logout', 'POST').catch(() => {});
      if (socket) socket.disconnect();
      window.location.href = 'login.html';
    };
  }
}

// Prefetch a page template in the background
function prefetchPage(url) {
  if (!url || url === '#' || url.startsWith('javascript:')) return;
  if (document.querySelector(`link[href="${url}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = url;
  document.head.appendChild(link);
}

// ── Unread badge in browser/app tab title ──────────────────────────────────
let _titleUnreadCount = 0;
const _baseTitle = document.title || 'Delulu';

function setTitleUnread(count) {
  _titleUnreadCount = Math.max(0, count);
  document.title = _titleUnreadCount > 0
    ? `(${_titleUnreadCount}) ${_baseTitle}`
    : _baseTitle;
}

// Clear unread when user focuses the tab
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) setTitleUnread(0);
});

window.setTitleUnread = setTitleUnread;

// ── Rich in-app message toast (Telegram-style) ────────────────────────────
// Shows: [Avatar initial] SenderName — message preview
// Tapping navigates to the chat.
function showRichToast({ senderName, preview, connectionId, avatarInitial }) {
  // Remove any existing rich toast first
  document.querySelectorAll('.delulu-rich-toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  const initial = (avatarInitial || (senderName ? senderName.charAt(0) : '?')).toUpperCase();

  toast.className = 'delulu-rich-toast fixed top-4 left-1/2 -translate-x-1/2 z-[99999] flex items-center gap-3 bg-surface shadow-2xl border border-outline-variant/20 rounded-2xl px-4 py-3 max-w-[90vw] w-80 cursor-pointer backdrop-blur-xl';
  toast.style.cssText += 'box-shadow: 0 8px 32px rgba(60,32,27,0.18);';
  toast.innerHTML = `
    <div style="width:36px;height:36px;border-radius:12px;background:linear-gradient(135deg,#a53b29,#d94828);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;flex-shrink:0;">${escapeHtml(initial)}</div>
    <div style="min-width:0;flex:1;">
      <div style="font-weight:700;font-size:13px;color:var(--color-on-surface,#1b1c1c);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(senderName || 'New message')}</div>
      <div style="font-size:12px;color:var(--color-on-surface-variant,#57423e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;">${escapeHtml(preview || '')}</div>
    </div>
    <span class="material-symbols-outlined" style="font-size:18px;color:var(--color-primary,#a53b29);flex-shrink:0;">chevron_right</span>
  `;

  if (connectionId) {
    toast.onclick = () => {
      window.location.href = `chat.html?id=${connectionId}`;
    };
  }

  document.body.appendChild(toast);

  // Auto dismiss after 4 seconds
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-8px)';
    setTimeout(() => toast.remove(), 320);
  }, 4000);
}

window.showRichToast = showRichToast;

function initHeartBackground() {
  const script = document.createElement('script');
  script.src = '/js/heart-bg.js';
  document.body.appendChild(script);
}

// ===== Dark Mode =====
function applyTheme(isDark) {
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
  }
  // Clear any leftover inline background-color overrides so CSS rules control theme cleanly
  document.documentElement.style.backgroundColor = '';
  document.body.style.backgroundColor = '';

  localStorage.setItem('delulu_theme', isDark ? 'dark' : 'light');

  // Update theme toggle icons across the page
  document.querySelectorAll('.theme-toggle-icon, #theme-toggle .material-symbols-outlined').forEach(el => {
    el.textContent = isDark ? 'light_mode' : 'dark_mode';
  });
}

function toggleTheme() {
  const isDarkNow = !document.documentElement.classList.contains('dark');
  applyTheme(isDarkNow);
  return isDarkNow;
}

window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;

function initDarkMode() {
  const saved = localStorage.getItem('delulu_theme');
  const isDark = saved === 'dark';
  applyTheme(isDark);
  
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.onclick = () => {
      toggleTheme();
    };
  }
}

// ===== Haptic Feedback =====
function hapticLight() {
  try { navigator.vibrate(10); } catch(e) {}
}
function hapticMedium() {
  try { navigator.vibrate(20); } catch(e) {}
}
function hapticHeavy() {
  try { navigator.vibrate([30, 50, 20]); } catch(e) {}
}

// ===== Global Show Toast (non-blocking notification) =====
// Replaces alert() for all non-critical messages. Supports error/success/warning types.
// Auto-dismisses after 2.5s (error) or 2s (success/info).
function showToast(msg, type) {
  // Deduplicate: don't show the same message twice in quick succession
  const existing = document.querySelector('.delulu-toast');
  if (existing && existing.textContent === msg) return;
  
  const toast = document.createElement('div');
  const isError = type === 'error';
  const isSuccess = type === 'success';
  let bgClass = 'bg-surface-container-high text-on-surface';
  if (isError) bgClass = 'bg-error/90 text-white';
  else if (isSuccess) bgClass = 'bg-emerald-600/90 text-white';
  
  toast.className = `delulu-toast fixed bottom-24 left-1/2 -translate-x-1/2 ${bgClass} px-6 py-3 rounded-2xl shadow-lg z-[99999] text-sm font-medium max-w-[90vw] text-center transition-all duration-300`;
  toast.style.transform = 'translateX(-50%) translateY(0)';
  toast.textContent = msg;
  document.body.appendChild(toast);
  
  // Error toasts show longer (4s) so users can read error messages
  const duration = isError ? 4000 : 2500;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ===== Undo Dismiss Toast =====
let toastContainer = null;
function showUndoToast(message, onUndo, duration = 4000) {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <span class="toast-undo">Undo</span>
  `;
  
  toast.querySelector('.toast-undo').onclick = () => {
    onUndo();
    toast.remove();
  };
  
  toastContainer.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      setTimeout(() => toast.remove(), 300);
    }
  }, duration);
}

// ===== Loading Skeletons =====
function showSkeleton(containerId, count = 3, type = 'line') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    if (type === 'circle') {
      el.className = 'skeleton skeleton-circle';
    } else if (type === 'card') {
      el.className = 'skeleton';
      el.style.height = '100px';
      el.style.marginBottom = '12px';
    } else {
      el.className = 'skeleton skeleton-line' + (i % 2 === 0 ? ' short' : '');
    }
    container.appendChild(el);
  }
}

function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem('delulu_device_id');
  if (!deviceId) {
    deviceId = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    localStorage.setItem('delulu_device_id', deviceId);
  }
  return deviceId;
}

// ===== Push & Native FCM Notification Subscription =====

// Route a tapped notification to the page it belongs to (chat, requests, messages).
function handlePushNotificationAction(data) {
  if (!data) data = {};
  const connId = data.connectionId || data.connection_id;
  const notifType = data.type;
  let targetUrl = data.url || '';

  // Normalize legacy URLs to real pages
  if (targetUrl.startsWith('/chat?')) targetUrl = '/chat.html' + targetUrl.slice('/chat'.length);
  if (targetUrl === '/requests') targetUrl = '/requests.html';
  if (targetUrl === '/messages') targetUrl = '/messages.html';

  if (connId) {
    window.location.href = `chat.html?id=${connId}`;
  } else if (notifType === 'connection_request' || notifType === 'connection_accepted') {
    window.location.href = 'requests.html';
  } else if (targetUrl && targetUrl !== '/' && targetUrl !== '') {
    window.location.href = targetUrl.startsWith('/') ? targetUrl.substring(1) : targetUrl;
  } else if (notifType === 'chat_message') {
    window.location.href = 'messages.html';
  } else {
    window.location.href = 'messages.html';
  }
}

// Register native push listeners EARLY (at script load) so a notification tap that
// cold-starts the app is not missed — initPushNotifications may run seconds later.
function registerCapacitorPushListeners() {
  if (!window.Capacitor || !window.Capacitor.isPluginAvailable || !window.Capacitor.isPluginAvailable('PushNotifications')) return;
  if (window.__capacitorPushListenerSet) return;
  window.__capacitorPushListenerSet = true;
  try {
    const PushNotifications = window.Capacitor.Plugins.PushNotifications;

    // Tap on a delivered FCM notification → navigate to the relevant page
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      handlePushNotificationAction(action.notification?.data || {});
    }).catch(() => {});

    // Foreground delivery — FCM delivers payload, we show high-priority banner / local notification
    PushNotifications.addListener('pushReceived', (notification) => {
      const data = (notification && notification.data) || {};
      const title = data.title || notification.title || data.senderName || 'New notification';
      const body = data.body || notification.body || '';
      const url = data.url || (data.connectionId ? `chat.html?id=${data.connectionId}` : 'messages.html');
      
      // If user is not currently in this chat room, alert them
      const activeChatId = new URLSearchParams(window.location.search).get('id');
      const isCurrentChat = activeChatId && data.connectionId && String(activeChatId) === String(data.connectionId);
      
      if (!isCurrentChat) {
        if (typeof window.hapticLight === 'function') window.hapticLight();
        if (typeof window.showRichToast === 'function') {
          window.showRichToast({
            senderName: title,
            preview: body,
            connectionId: data.connectionId
          });
        }
        window.showNativeNotification({ title, body, url, id: data.messageId || data.connectionId });
      }
    }).catch(() => {});

    PushNotifications.addListener('registrationError', (error) => {
      console.warn('[Capacitor] Push registration error:', error);
    }).catch(() => {});
  } catch (e) {
    console.warn('[Capacitor] Push listener registration failed:', e.message);
  }
}

// Tap on a LocalNotification (in-app scheduled) → route via its extra.url
function registerLocalNotificationTap() {
  if (!window.Capacitor || !window.Capacitor.isPluginAvailable || !window.Capacitor.isPluginAvailable('LocalNotifications')) return;
  if (window.__capacitorLocalNotifListenerSet) return;
  window.__capacitorLocalNotifListenerSet = true;
  try {
    const LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
    LocalNotifications.addListener('localNotificationActionPerformed', (res) => {
      const url = (res && res.notification && res.notification.extra && res.notification.extra.url) || 'messages.html';
      window.location.href = url.startsWith('/') ? url.substring(1) : url;
    }).catch(() => {});
  } catch (e) {}
}

// Register native tap handling as early as possible
registerCapacitorPushListeners();
registerLocalNotificationTap();

async function initPushNotifications() {
  const deviceId = getOrCreateDeviceId();

  // 1. Native Capacitor FCM Push Notifications (Android / iOS native app)
  if (window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('PushNotifications')) {
    try {
      const PushNotifications = window.Capacitor.Plugins.PushNotifications;
      const LocalNotifications = (window.Capacitor.isPluginAvailable('LocalNotifications'))
        ? window.Capacitor.Plugins.LocalNotifications
        : null;

      // Ensure notification channel exists with MAX priority (sound + vibration)
      if (LocalNotifications && typeof LocalNotifications.createChannel === 'function') {
        await LocalNotifications.createChannel({
          id: 'delulu_messages',
          name: 'Delulu Messages',
          description: 'Instant chat message and connection notifications',
          importance: 5,
          vibration: true,
          sound: 'default',
          visibility: 1
        }).catch(() => {});
      }

      // Pre-bind registration listeners BEFORE calling register()
      PushNotifications.addListener('registration', async (token) => {
        if (token && token.value) {
          await apiCall('/api/devices/register', 'POST', {
            deviceId,
            platform: 'android_fcm',
            token: token.value,
            app_version: '1.0.0'
          }).catch(() => {});
          await apiCall('/api/push/fcm-token', 'POST', { token: token.value }).catch(() => {});
          dbg('[Push] FCM registered token successfully');
        }
      }).catch(() => {});

      // Ensure tap listeners are active
      registerCapacitorPushListeners();
      registerLocalNotificationTap();

      // Request runtime notification permissions (Android 13+ / iOS)
      if (typeof PushNotifications.requestPermissions === 'function') {
        let perm = await PushNotifications.requestPermissions().catch(() => ({ receive: 'prompt' }));
        if (LocalNotifications && typeof LocalNotifications.requestPermissions === 'function') {
          await LocalNotifications.requestPermissions().catch(() => {});
        }
        if (perm && (perm.receive === 'granted' || perm.display === 'granted')) {
          await PushNotifications.register().catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[Capacitor] Push notifications setup safely bypassed:', e.message);
    }
  }

  // 2. Web Browser (Web Push API fallback)
  if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) return;
  
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    
    let reg;
    if (navigator.serviceWorker.controller) {
      reg = await navigator.serviceWorker.ready;
    } else {
      reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      reg = await navigator.serviceWorker.ready;
    }
    
    const keyRes = await fetch(resolveUrl('/api/push/vapid-key'), { credentials: 'include' });
    const keyData = await keyRes.json();
    if (!keyData.publicKey) return;
    
    // Check if existing subscription is still valid for this VAPID key
    let sub = await reg.pushManager.getSubscription();
    
    if (sub) {
      await apiCall('/api/push/subscribe', 'POST', { subscription: sub.toJSON() }).catch(() => {
        sub.unsubscribe();
        sub = null;
      });
    }
    
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyData.publicKey
      });
      await apiCall('/api/push/subscribe', 'POST', { subscription: sub.toJSON() });
    }

    if (sub) {
      await apiCall('/api/devices/register', 'POST', {
        deviceId,
        platform: 'web_push',
        web_push_subscription: sub.toJSON(),
        app_version: '1.0.0'
      }).catch(() => {});
      dbg('Web Push device registered');
    }
  } catch (err) {
    dbg('Push notification setup deferred:', err.message);
  }
}

// ===== Global Native Notification Trigger Helper =====
async function showNativeNotification({ title, body, url, id }) {
  const safeTitle = title && title.trim() ? title : 'New notification';
  const safeBody = body && body.trim() ? body : 'You have a new notification';
  const safeUrl = url && url !== '/' ? url : 'messages.html';

  // Capacitor LocalNotifications requires a valid 32-bit positive integer ID
  let notifId;
  if (typeof id === 'number' && Number.isInteger(id)) {
    notifId = Math.abs(id % 2147483647);
  } else if (typeof id === 'string' && /^\d+$/.test(id)) {
    notifId = Math.abs(parseInt(id, 10) % 2147483647);
  } else {
    notifId = Math.floor(Math.random() * 2000000000) + 1;
  }

  // If running inside Capacitor Native App
  if (window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('LocalNotifications')) {
    try {
      const LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
      if (typeof LocalNotifications.createChannel === 'function') {
        await LocalNotifications.createChannel({
          id: 'delulu_messages',
          name: 'Delulu Messages',
          description: 'Instant chat message and connection notifications',
          importance: 5,
          vibration: true,
          sound: 'default',
          visibility: 1
        }).catch(() => {});
      }
      await LocalNotifications.schedule({
        notifications: [
          {
            title: safeTitle,
            body: safeBody,
            id: notifId,
            schedule: { at: new Date(Date.now() + 50) },
            extra: { url: safeUrl },
            channelId: 'delulu_messages',
            smallIcon: 'ic_launcher'
          }
        ]
      });
      return;
    } catch (err) {
      console.warn('[Capacitor] Failed to schedule notification:', err);
    }
  }

  // Web Browser fallback
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(safeTitle, {
        body: safeBody,
        icon: '/favicon.ico',
        data: { url: safeUrl }
      });
    } catch (e) {}
  }
}

window.showNativeNotification = showNativeNotification;

// ===== Global Background User Event Stream =====
// Powers real-time message toasts and notification alerts across ALL pages
let _globalUserStream = null;
let _globalStreamBackoff = 2000;

async function initGlobalUserStream() {
  // messages.html and chat.html have their own dedicated real-time handlers
  const pathname = window.location.pathname;
  if (pathname.includes('messages.html') || pathname.includes('chat.html')) return;
  if (_globalUserStream || !currentUser) return;

  try {
    const streamUrl = await buildSSEUrl('/api/user/stream');
    _globalUserStream = new EventSource(streamUrl);

    _globalUserStream.onmessage = (event) => {
      if (!event.data || event.data.startsWith(':')) return;
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      _globalStreamBackoff = 2000;

      if (data.type === 'message') {
        if (typeof window.hapticLight === 'function') window.hapticLight();
        if (typeof window.showRichToast === 'function') {
          window.showRichToast({
            senderName: data.senderName || 'New message',
            preview: data.lastMessage || 'Sent you a message',
            connectionId: data.connectionId
          });
        }
        if (document.hidden) {
          window.showNativeNotification({
            title: data.senderName || 'New message',
            body: data.lastMessage || 'You have a new message',
            url: `chat.html?id=${data.connectionId}`,
            id: data.connectionId
          });
        }
      } else if (data.type === 'connection_request') {
        if (typeof window.hapticMedium === 'function') window.hapticMedium();
        if (typeof window.showToast === 'function') {
          window.showToast(`${data.senderName || 'Someone'} sent you a connection request!`, 'info');
        }
        if (document.hidden) {
          window.showNativeNotification({
            title: 'New Connection Request',
            body: `${data.senderName || 'Someone'} wants to connect with you!`,
            url: 'requests.html',
            id: data.senderId
          });
        }
      } else if (data.type === 'match_celebration') {
        if (typeof window.showMatchCelebration === 'function') {
          window.showMatchCelebration(data.username, data.connectionId);
        }
      }
    };

    _globalUserStream.onerror = () => {
      if (_globalUserStream) {
        _globalUserStream.close();
        _globalUserStream = null;
      }
      setTimeout(initGlobalUserStream, Math.min(_globalStreamBackoff *= 2, 30000));
    };
  } catch (e) {
    _globalUserStream = null;
  }
}

// ===== Connection Timeline Helper =====
function getConnectionProgress(status, chatStartedAt, identityRevealAvailableAt, faceRevealAvailableAt) {
  const now = Date.now();
  const stages = [
    { label: 'Matched', done: true },
    { label: 'Chatting', done: !!chatStartedAt }
  ];
  
  // The Day-10 face reveal is the only reveal milestone (Day-7 identity reveal was removed).
  if (faceRevealAvailableAt && now >= new Date(faceRevealAvailableAt)) {
    stages.push({ label: 'Face Reveal', done: false, active: true });
  } else if (faceRevealAvailableAt) {
    stages.push({ label: 'Face Reveal', done: false });
  } else {
    stages.push({ label: 'Chatting', done: true });
  }
  
  return stages;
}

// ===== Android Hardware Back Button Navigation =====
let lastBackPressTime = 0;

function initNativeBackButton() {
  if (!window.Capacitor || !window.Capacitor.isPluginAvailable('App')) return;
  const App = window.Capacitor.Plugins.App;
  
  if (window.__capacitorBackButtonSet) return;
  window.__capacitorBackButtonSet = true;

  App.addListener('backButton', () => {
    // 0. Close active modal overlay first if open
    const openModalEl = document.querySelector('#modal-overlay:not(.hidden)');
    if (openModalEl && typeof window.closeModal === 'function') {
      window.closeModal();
      return;
    }

    const path = window.location.pathname;
    const currentFile = path.substring(path.lastIndexOf('/') + 1);

    // 1. If viewing a Chat screen -> go back to Messages list
    if (currentFile.startsWith('chat.html') || path.includes('chat')) {
      window.location.replace('messages.html');
      return;
    }

    // 2. If viewing Messages, Requests, or Profile -> go back to Discover (Home)
    if (currentFile === 'messages.html' || currentFile === 'requests.html' || currentFile === 'profile.html') {
      window.location.replace('discover.html');
      return;
    }

    // 3. If on Discover or Login -> double-tap back button to exit app safely
    if (currentFile === 'discover.html' || currentFile === 'login.html' || currentFile === '' || currentFile === 'index.html') {
      const now = Date.now();
      if (now - lastBackPressTime < 2000) {
        App.exitApp();
      } else {
        lastBackPressTime = now;
        if (typeof showToast === 'function') {
          showToast('Press back again to exit');
        }
      }
      return;
    }

    // Fallback
    window.location.replace('discover.html');
  });
}

// Automatically bind setup on every page
document.addEventListener('DOMContentLoaded', () => {
  setupLogout();
  initDarkMode();
  initNativeBackButton();
  
  // Defer heart background to after page is fully interactive.
  // Skip entirely on Capacitor native (Android/iOS) — the decorative canvas
  // animation is expensive on mobile CPUs and noticeably slows page rendering.
  if (!isCapacitorNative) {
    if (document.querySelector('#heart-bg') || !document.querySelector('[data-no-hearts]')) {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => initHeartBackground(), { timeout: 2000 });
      } else {
        setTimeout(initHeartBackground, 500);
      }
    }
  }

  // Prefetch navigation tabs on hover
  document.querySelectorAll('a').forEach(link => {
    link.addEventListener('mouseenter', () => {
      prefetchPage(link.getAttribute('href'));
    });
  });
  
});

// ─── Explicit window exports ───────────────────────────────────────────────
// type="module" scripts (login.js, settings.js, etc.) run in strict ES-module
// scope and cannot see bare function declarations from classic <script> tags.
// Assigning to window makes every utility reliably available cross-script.
window.initPushNotifications    = initPushNotifications;
window.apiCall                  = apiCall;
window.getSSEToken              = getSSEToken;
window.buildSSEUrl              = buildSSEUrl;
window.showToast                = showToast;
window.showUndoToast            = showUndoToast;
window.showRichToast            = showRichToast;
window.setStoredAuthToken       = setStoredAuthToken;
window.getStoredAuthToken       = getStoredAuthToken;
window.removeStoredAuthToken    = removeStoredAuthToken;
window.requireAuth              = requireAuth;
window.setupLogout              = setupLogout;
window.getPasswordStrengthError = getPasswordStrengthError;
window.reencryptE2EEKeysForNewPassword = reencryptE2EEKeysForNewPassword;
window.escapeHtml               = escapeHtml;
window.resolveUrl               = resolveUrl;
window.getAvatarHtml            = getAvatarHtml;
window.formatTime               = formatTime;
window.getCountdown             = getCountdown;
window.setTitleUnread           = setTitleUnread;
window.getOrCreateDeviceId      = getOrCreateDeviceId;
window.handlePushNotificationAction = handlePushNotificationAction;
window.showSkeleton             = showSkeleton;
window.hasForbiddenText         = hasForbiddenText;
window.findForbiddenText        = findForbiddenText;
window.applyTheme               = applyTheme;
window.toggleTheme              = toggleTheme;
window.getConnectionProgress    = getConnectionProgress;
window.hapticLight              = hapticLight;
window.hapticMedium             = hapticMedium;
window.hapticHeavy              = hapticHeavy;
window.updateHeaderAvatar       = updateHeaderAvatar;
window.prefetchPage             = prefetchPage;
window.showReconnectBanner      = showReconnectBanner;
window.hideReconnectBanner      = hideReconnectBanner;
window.dbg                      = dbg;
window.dbgWarn                  = dbgWarn;
