let currentSettings = null;
let checkUsernameTimer = null;
let isUsernameAvailable = false;
let lastCheckedValue = '';      // username the last availability check was for
let lastCheckSaidTaken = false; // only block submit when a check CONFIRMED taken

document.addEventListener('DOMContentLoaded', async () => {
  await requireAuth();
  await loadUserSettings();
  setupUsernameEvents();
  setupPasswordResetEvents();
  setup2FAEvents();
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
    render2FAStatus(data);
  } catch (err) {
    showToast(`Failed to load settings: ${err.message}`, 'error');
  }
}

// Render the two-factor authentication status row from user-info
function render2FAStatus(data) {
  const enabled = !!(data && data.totp_enabled);
  const statusText = document.getElementById('2fa-status-text');
  const statusIcon = document.getElementById('2fa-status-icon');
  const btnSetup = document.getElementById('btn-2fa-setup');
  const btnDisable = document.getElementById('btn-2fa-disable');
  if (!statusText) return;

  statusText.textContent = enabled ? 'Enabled' : 'Off';
  if (statusIcon) {
    statusIcon.textContent = enabled ? 'verified_user' : 'shield';
    statusIcon.className = `material-symbols-outlined text-xl shrink-0 ${enabled ? 'text-emerald-500' : 'text-outline'}`;
  }
  if (btnSetup) btnSetup.classList.toggle('hidden', enabled);
  if (btnDisable) btnDisable.classList.toggle('hidden', !enabled);

  // Hide any in-progress panels whenever status is (re)rendered
  hide2FAPanels();
}

function hide2FAPanels() {
  ['2fa-setup-panel', '2fa-backup-panel', '2fa-disable-panel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }
  });
  ['2fa-setup-error', '2fa-disable-error'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const verifyCode = document.getElementById('2fa-verify-code');
  const disableCode = document.getElementById('2fa-disable-code');
  if (verifyCode) verifyCode.value = '';
  if (disableCode) disableCode.value = '';
}

function show2FAPanel(id) {
  hide2FAPanels();
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('hidden');
    el.classList.add('flex');
  }
}

// Two-factor authentication (TOTP) enrollment / disable
function setup2FAEvents() {
  const btnSetup = document.getElementById('btn-2fa-setup');
  const btnDisable = document.getElementById('btn-2fa-disable');
  const btnVerify = document.getElementById('btn-2fa-verify');
  const btnCancelSetup = document.getElementById('btn-2fa-cancel-setup');
  const btnBackupDone = document.getElementById('btn-2fa-backup-done');
  const btnDisableConfirm = document.getElementById('btn-2fa-disable-confirm');
  const btnDisableCancel = document.getElementById('btn-2fa-disable-cancel');

  if (btnSetup) {
    btnSetup.addEventListener('click', async () => {
      btnSetup.disabled = true;
      btnSetup.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Generating...';
      try {
        const res = await apiCall('/api/settings/2fa/setup', 'POST');
        const qr = document.getElementById('2fa-qr');
        const secretEl = document.getElementById('2fa-secret');
        if (qr) qr.src = res.qrDataUrl;
        if (secretEl) secretEl.textContent = res.secret;
        show2FAPanel('2fa-setup-panel');
        document.getElementById('2fa-verify-code')?.focus();
      } catch (err) {
        showToast(err.message || 'Failed to start setup', 'error');
      } finally {
        btnSetup.disabled = false;
        btnSetup.innerHTML = '<span class="material-symbols-outlined text-sm">add</span> Set Up';
      }
    });
  }

  if (btnVerify) {
    btnVerify.addEventListener('click', async () => {
      const code = document.getElementById('2fa-verify-code').value.trim();
      const errEl = document.getElementById('2fa-setup-error');
      errEl.classList.add('hidden');
      if (!code || code.length !== 6 || !/^[0-9]{6}$/.test(code)) {
        errEl.textContent = 'Enter the 6-digit code from your authenticator app';
        errEl.classList.remove('hidden');
        return;
      }
      btnVerify.disabled = true;
      btnVerify.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span> Verifying...';
      try {
        const res = await apiCall('/api/settings/2fa/verify', 'POST', { code });
        hapticMedium();
        // Show the one-time backup codes
        const backupEl = document.getElementById('2fa-backup-codes');
        if (backupEl && Array.isArray(res.backupCodes)) {
          backupEl.innerHTML = res.backupCodes.map(c => `<span class="bg-surface-container-high rounded-lg px-2.5 py-1.5 text-center">${c}</span>`).join('');
        }
        show2FAPanel('2fa-backup-panel');
      } catch (err) {
        hapticHeavy();
        errEl.textContent = err.message || 'Failed to enable two-factor authentication';
        errEl.classList.remove('hidden');
        document.getElementById('2fa-verify-code').value = '';
        document.getElementById('2fa-verify-code').focus();
      } finally {
        btnVerify.disabled = false;
        btnVerify.innerHTML = '<span class="material-symbols-outlined text-lg">verified_user</span> Verify & Enable';
      }
    });
  }

  if (btnCancelSetup) {
    btnCancelSetup.addEventListener('click', () => {
      hide2FAPanels();
      // Re-fetch status (an aborted setup leaves 2FA off)
      loadUserSettings();
    });
  }

  if (btnBackupDone) {
    btnBackupDone.addEventListener('click', async () => {
      hide2FAPanels();
      showToast('Two-factor authentication is now enabled', 'success');
      await loadUserSettings();
    });
  }

  if (btnDisable) {
    btnDisable.addEventListener('click', () => {
      show2FAPanel('2fa-disable-panel');
      document.getElementById('2fa-disable-code')?.focus();
    });
  }

  if (btnDisableConfirm) {
    btnDisableConfirm.addEventListener('click', async () => {
      const code = document.getElementById('2fa-disable-code').value.trim();
      const errEl = document.getElementById('2fa-disable-error');
      errEl.classList.add('hidden');
      if (!code || code.length !== 6 || !/^[0-9]{6}$/.test(code)) {
        errEl.textContent = 'Enter the 6-digit code from your authenticator app';
        errEl.classList.remove('hidden');
        return;
      }
      btnDisableConfirm.disabled = true;
      btnDisableConfirm.textContent = 'Disabling...';
      try {
        await apiCall('/api/settings/2fa/disable', 'POST', { code });
        hapticHeavy();
        hide2FAPanels();
        showToast('Two-factor authentication disabled', 'success');
        await loadUserSettings();
      } catch (err) {
        hapticHeavy();
        errEl.textContent = err.message || 'Failed to disable two-factor authentication';
        errEl.classList.remove('hidden');
        document.getElementById('2fa-disable-code').value = '';
        document.getElementById('2fa-disable-code').focus();
      } finally {
        btnDisableConfirm.disabled = false;
        btnDisableConfirm.textContent = 'Disable Two-Factor Authentication';
      }
    });
  }

  if (btnDisableCancel) {
    btnDisableCancel.addEventListener('click', hide2FAPanels);
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
    // BUG FIX: Always re-enable the input so it can't get stuck in a disabled state
    const usernameInput = document.getElementById('input-username');
    if (usernameInput) {
      usernameInput.disabled = false;
      usernameInput.classList.remove('opacity-60', 'cursor-not-allowed');
    }
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
      lastCheckedValue = '';
      lastCheckSaidTaken = false;
      return;
    }

    // Quick regex validation
    if (val.length < 3 || val.length > 20 || !/^[a-zA-Z0-9_]+$/.test(val)) {
      msgEl.textContent = '3-20 characters (letters, numbers, underscores only)';
      msgEl.className = 'text-xs font-semibold mt-1.5 pl-1 text-error block';
      iconEl.innerHTML = '<span class="material-symbols-outlined text-error text-lg">cancel</span>';
      isUsernameAvailable = false;
      lastCheckedValue = val;
      lastCheckSaidTaken = true; // format invalid — treat as not allowed
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
        lastCheckedValue = frozenVal;
        if (res.available) {
          msgEl.textContent = 'Username is available!';
          msgEl.className = 'text-xs font-semibold mt-1.5 pl-1 text-emerald-600 dark:text-emerald-400 block';
          iconEl.innerHTML = '<span class="material-symbols-outlined text-emerald-500 text-lg">check_circle</span>';
          isUsernameAvailable = true;
          lastCheckSaidTaken = false;
        } else {
          msgEl.textContent = res.message || 'Username is already taken';
          msgEl.className = 'text-xs font-semibold mt-1.5 pl-1 text-error block';
          iconEl.innerHTML = '<span class="material-symbols-outlined text-error text-lg">cancel</span>';
          isUsernameAvailable = false;
          lastCheckSaidTaken = true;
        }
      } catch (err) {
        if (usernameInput.value.trim() !== frozenVal) return;
        msgEl.textContent = err.message || 'Failed to verify username';
        msgEl.className = 'text-xs font-semibold mt-1.5 pl-1 text-error block';
        iconEl.innerHTML = '';
        // Network error — do NOT mark as taken; the server re-validates on submit
        lastCheckedValue = '';
        lastCheckSaidTaken = false;
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

      // Block submission ONLY when we have a confirmed verdict for this exact
      // value — an unavailable check or an in-flight/errored check must not
      // deadlock the form (the server re-validates availability anyway).
      if (val === lastCheckedValue && lastCheckSaidTaken) {
        showToast('This username is not available', 'error');
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
        // Update local session AND persisted cache so other pages (profile,
        // messages, etc.) show the new username immediately.
        if (window.currentUser) {
          window.currentUser.username = val;
          try {
            window.localStorage.setItem('cached_user', JSON.stringify(window.currentUser));
          } catch (e) {}
          updateHeaderAvatar();
        }
        await loadUserSettings();
      } catch (err) {
        hapticHeavy();
        showToast(err.message, 'error');
      } finally {
        // After a successful change the 15-day cooldown is active — keep the
        // button disabled instead of re-enabling it.
        btn.disabled = !!(currentSettings && !currentSettings.can_change_username);
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
        document.getElementById('input-pwd-otp')?.focus();
      } catch (err) {
        hapticHeavy();
        showToast(err.message, 'error');
      } finally {
        btnSendCode.disabled = false;
        btnSendCode.innerHTML = '<span class="material-symbols-outlined text-lg">send</span> Send Reset Code to Email';
      }
    });
  }

  // BUG FIX: Resend code — go back to step 1 to request a fresh OTP
  const btnResend = document.getElementById('btn-pwd-resend');
  const btnCancel = document.getElementById('btn-pwd-cancel');

  function resetPasswordSteps() {
    if (formReset) {
      formReset.reset();
      formReset.classList.add('hidden');
    }
    if (pwdStep1) pwdStep1.classList.remove('hidden');
    if (errorMsg) errorMsg.classList.add('hidden');
  }

  if (btnResend) {
    btnResend.addEventListener('click', async () => {
      resetPasswordSteps();
      // Auto-trigger resend
      if (btnSendCode) btnSendCode.click();
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      resetPasswordSteps();
      showToast('Password reset cancelled', 'info');
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

      const pwStrengthErr = getPasswordStrengthError(newPwd);
      if (pwStrengthErr) {
        errorMsg.textContent = pwStrengthErr;
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
        // Re-encrypt the E2EE private key with the new password so chat history
        // stays recoverable after the password change.
        const e2eePayload = await reencryptE2EEKeysForNewPassword(newPwd, currentSettings?.email || '');
        const res = await apiCall('/api/settings/password-reset/verify-and-update', 'POST', {
          otp,
          newPassword: newPwd,
          encrypted_private_key: e2eePayload.encrypted_private_key,
          public_key: e2eePayload.public_key
        });
        hapticHeavy();
        showToast(res.message || 'Password updated successfully!');
        // Persist a freshly minted private key ONLY after the server accepted
        // the change, keeping the local keypair in sync with the server.
        if (e2eePayload.privateKeyJwk) {
          window.localStorage.setItem('e2ee_private_key', JSON.stringify(e2eePayload.privateKeyJwk));
        }
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
