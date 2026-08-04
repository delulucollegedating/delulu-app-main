let currentSettings = null;
let checkUsernameTimer = null;
let isUsernameAvailable = false;

document.addEventListener('DOMContentLoaded', async () => {
  await requireAuth();
  await loadUserSettings();
  setupUsernameEvents();
  setupPasswordResetEvents();
});

// Load Settings User Info
async function loadUserSettings() {
  try {
    const data = await apiCall('/api/settings/user-info');
    currentSettings = data;

    // Display current values
    const usernameInput = document.getElementById('input-username');
    if (usernameInput) {
      usernameInput.value = data.username || '';
    }

    const emailEl = document.getElementById('user-registered-email');
    if (emailEl) {
      emailEl.textContent = data.email || 'No email registered';
    }

    renderCooldownBanner(data);
  } catch (err) {
    showToast(`Failed to load settings: ${err.message}`, 'error');
  }
}

// Render 15-Day Username Cooldown Banner
function renderCooldownBanner(data) {
  const banner = document.getElementById('username-cooldown-banner');
  const btnUpdate = document.getElementById('btn-update-username');
  if (!banner) return;

  if (data.can_change_username) {
    banner.className = 'mb-4 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 flex items-start gap-3';
    banner.innerHTML = `
      <span class="material-symbols-outlined text-emerald-600 dark:text-emerald-400 text-xl shrink-0 mt-0.5">verified</span>
      <div>
        <p class="text-xs font-bold">Username update available</p>
        <p class="text-[11px] opacity-90 mt-0.5">You can update your username today. Note: Once changed, you cannot change it again for the next 15 days.</p>
      </div>
    `;
    if (btnUpdate) btnUpdate.disabled = false;
  } else {
    const unlockStr = data.next_allowed_at 
      ? new Date(data.next_allowed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '15 days';
    
    banner.className = 'mb-4 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 flex items-start gap-3';
    banner.innerHTML = `
      <span class="material-symbols-outlined text-amber-600 dark:text-amber-400 text-xl shrink-0 mt-0.5">lock_clock</span>
      <div>
        <p class="text-xs font-bold">Username locked for ${data.days_remaining} more day${data.days_remaining > 1 ? 's' : ''}</p>
        <p class="text-[11px] opacity-90 mt-0.5">You recently changed your username. You can change it again on <strong>${unlockStr}</strong>.</p>
      </div>
    `;
    if (btnUpdate) {
      btnUpdate.disabled = true;
    }
    const usernameInput = document.getElementById('input-username');
    if (usernameInput) {
      usernameInput.disabled = true;
      usernameInput.classList.add('opacity-60', 'cursor-not-allowed');
    }
  }
}

// Setup Username Change Events & Real-time Validation
function setupUsernameEvents() {
  const usernameInput = document.getElementById('input-username');
  const msgEl = document.getElementById('username-availability-msg');
  const iconEl = document.getElementById('username-status-icon');
  const form = document.getElementById('form-username');

  if (!usernameInput) return;

  usernameInput.addEventListener('input', () => {
    const val = usernameInput.value.trim();
    clearTimeout(checkUsernameTimer);

    if (!val || (currentSettings && val === currentSettings.username)) {
      msgEl.classList.add('hidden');
      iconEl.innerHTML = '';
      isUsernameAvailable = false;
      return;
    }

    // Quick regex validation
    if (val.length < 3 || val.length > 20 || !/^[a-zA-Z0-9_]+$/.test(val)) {
      msgEl.textContent = '3-20 characters (letters, numbers, underscores only)';
      msgEl.className = 'text-xs font-semibold mt-1.5 pl-1 text-error block';
      iconEl.innerHTML = '<span class="material-symbols-outlined text-error text-lg">cancel</span>';
      isUsernameAvailable = false;
      return;
    }

    iconEl.innerHTML = '<span class="material-symbols-outlined text-outline text-lg animate-spin">refresh</span>';
    msgEl.textContent = 'Checking availability...';
    msgEl.className = 'text-xs font-semibold mt-1.5 pl-1 text-on-surface-variant block';

    checkUsernameTimer = setTimeout(async () => {
      // RACE CONDITION FIX: capture the value at timer-fire time and bail
      // out if the user has typed something different while the request was
      // queued, so a slow response never marks the wrong username "available".
      const frozenVal = val;
      try {
        const res = await apiCall('/api/settings/check-username', 'POST', { username: frozenVal });
        // Discard result if input changed while we were waiting
        if (usernameInput.value.trim() !== frozenVal) return;
        if (res.available) {
          msgEl.textContent = 'Username is available!';
          msgEl.className = 'text-xs font-semibold mt-1.5 pl-1 text-emerald-600 dark:text-emerald-400 block';
          iconEl.innerHTML = '<span class="material-symbols-outlined text-emerald-500 text-lg">check_circle</span>';
          isUsernameAvailable = true;
        } else {
          msgEl.textContent = res.message || 'Username is already taken';
          msgEl.className = 'text-xs font-semibold mt-1.5 pl-1 text-error block';
          iconEl.innerHTML = '<span class="material-symbols-outlined text-error text-lg">cancel</span>';
          isUsernameAvailable = false;
        }
      } catch (err) {
        if (usernameInput.value.trim() !== frozenVal) return;
        msgEl.textContent = err.message || 'Failed to verify username';
        msgEl.className = 'text-xs font-semibold mt-1.5 pl-1 text-error block';
        iconEl.innerHTML = '';
        isUsernameAvailable = false;
      }
    }, 400);
  });

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = usernameInput.value.trim();

      if (currentSettings && !currentSettings.can_change_username) {
        showToast('Username change is currently locked for 15 days', 'error');
        return;
      }

      if (currentSettings && val === currentSettings.username) {
        showToast('New username is the same as your current username', 'info');
        return;
      }

      // BUG FIX: Block submission if availability was never confirmed via the API check
      if (val !== (currentSettings && currentSettings.username) && !isUsernameAvailable) {
        showToast('Please wait for username availability to be confirmed', 'error');
        usernameInput.focus();
        return;
      }

      const btn = document.getElementById('btn-update-username');
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span> Updating...';

      try {
        const res = await apiCall('/api/settings/update-username', 'POST', { username: val });
        hapticMedium();
        showToast('Username updated successfully!');
        // Reset availability flag so user must re-check before another change
        isUsernameAvailable = false;
        msgEl.classList.add('hidden');
        iconEl.innerHTML = '';
        // Update local session
        if (window.currentUser) window.currentUser.username = val;
        await loadUserSettings();
      } catch (err) {
        hapticHeavy();
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-lg">check_circle</span> Save New Username';
      }
    });
  }
}

// Setup Password Reset Events (Logged in user)
function setupPasswordResetEvents() {
  const btnSendCode = document.getElementById('btn-send-pwd-code');
  const formReset = document.getElementById('form-reset-password');
  const pwdStep1 = document.getElementById('pwd-step-1');
  const errorMsg = document.getElementById('pwd-error-msg');

  if (btnSendCode) {
    btnSendCode.addEventListener('click', async () => {
      btnSendCode.disabled = true;
      btnSendCode.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span> Sending Code...';

      try {
        const res = await apiCall('/api/settings/password-reset/send-code', 'POST');
        hapticLight();
        showToast(res.message || 'Verification code sent to your email!');
        pwdStep1.classList.add('hidden');
        formReset.classList.remove('hidden');
      } catch (err) {
        hapticHeavy();
        showToast(err.message, 'error');
      } finally {
        btnSendCode.disabled = false;
        btnSendCode.innerHTML = '<span class="material-symbols-outlined text-lg">send</span> Send Reset Code to Email';
      }
    });
  }

  if (formReset) {
    formReset.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.classList.add('hidden');

      const otp = document.getElementById('input-pwd-otp').value.trim();
      const newPwd = document.getElementById('input-pwd-new').value;
      const confirmPwd = document.getElementById('input-pwd-confirm').value;

      if (!otp || otp.length !== 6 || !/^[0-9]{6}$/.test(otp)) {
        errorMsg.textContent = 'Please enter the 6-digit numeric verification code';
        errorMsg.classList.remove('hidden');
        return;
      }

      if (newPwd.length < 6) {
        errorMsg.textContent = 'Password must be at least 6 characters long';
        errorMsg.classList.remove('hidden');
        return;
      }

      if (newPwd !== confirmPwd) {
        errorMsg.textContent = 'Passwords do not match. Please re-enter.';
        errorMsg.classList.remove('hidden');
        return;
      }

      const btnUpdate = document.getElementById('btn-update-password');
      btnUpdate.disabled = true;
      btnUpdate.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span> Updating Password...';

      try {
        const res = await apiCall('/api/settings/password-reset/verify-and-update', 'POST', {
          otp,
          newPassword: newPwd
        });
        hapticHeavy();
        showToast(res.message || 'Password updated successfully!');
        formReset.reset();
        formReset.classList.add('hidden');
        pwdStep1.classList.remove('hidden');
      } catch (err) {
        hapticHeavy();
        errorMsg.textContent = err.message || 'Failed to update password';
        errorMsg.classList.remove('hidden');
      } finally {
        btnUpdate.disabled = false;
        btnUpdate.innerHTML = '<span class="material-symbols-outlined text-lg">published_with_changes</span> Update Password';
      }
    });
  }
}
