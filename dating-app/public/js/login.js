
document.addEventListener('DOMContentLoaded', async () => {
  // Session check runs in the BACKGROUND — awaiting it here used to block every
  // button binding below, leaving the page completely dead while a cold-started
  // server or slow network answered (10–60s). Now the form is interactive
  // immediately and we redirect to discover only once the check confirms.
  (async () => {
    try {
      const data = await Promise.race([
        apiCall('/api/session'),
        new Promise((resolve) => setTimeout(() => resolve(null), 8000))
      ]);
      if (data && data.authenticated) {
        markSessionVerified();
        window.location.replace('discover.html');
      }
    } catch (err) { /* not logged in / network error — stay on the login page */ }
  })();

  // State
  let currentEmail = '';
  const errEl = document.getElementById('email-error');
  const loginErrEl = document.getElementById('login-error');

  // DOM refs
  const stageLogin = document.getElementById('stage-login');
  const stageEmail = document.getElementById('stage-email');
  const stageOtp = document.getElementById('stage-otp');
  const stageProfile = document.getElementById('stage-profile');
  
  const inputEmail = document.getElementById('input-email');
  const otpEmailDisplay = document.getElementById('otp-email-display');

  const stepDots = [1, 2, 3].map(i => document.getElementById(`step-dot-${i}`));
  const stepLines = [1, 2].map(i => document.getElementById(`step-line-${i}`));

  function showStage(stage) {
    [stageLogin, stageEmail, stageOtp, stageProfile].forEach(s => {
      s.classList.add('hidden');
      s.classList.remove('stage-enter');
    });
    
    requestAnimationFrame(() => {
      stage.classList.remove('hidden');
      requestAnimationFrame(() => {
        stage.classList.add('stage-enter');
      });
    });

    // Update progress dots
    const stageMap = { 0: stageEmail, 1: stageOtp, 2: stageProfile };
    const currentIdx = Object.values(stageMap).indexOf(stage);
    
    stepDots.forEach((dot, i) => {
      dot.classList.remove('active', 'completed');
      if (i < currentIdx) dot.classList.add('completed');
      else if (i === currentIdx) dot.classList.add('active');
    });
    stepLines.forEach((line, i) => {
      line.className = `h-px w-8 ${i < currentIdx ? 'bg-primary' : 'bg-outline-variant'}`;
    });
  }

  // Toggle buttons
  document.getElementById('btn-go-signup').onclick = () => {
    showStage(stageEmail);
    inputEmail.focus();
  };

  document.getElementById('btn-go-login').onclick = () => {
    showStage(stageLogin);
    document.getElementById('login-username').focus();
  };

  document.getElementById('btn-back-email').onclick = () => {
    showStage(stageEmail);
    inputEmail.focus();
  };

  // ===== STAGE 0: Email/Username + Password Login =====
  const loginUsernameInput = document.getElementById('login-username');
  const loginPasswordInput = document.getElementById('login-password');

  // Shared post-auth completion: persist token + cached user, decrypt E2EE keys,
  // then redirect.
  async function finishLogin(data, password) {
    const user = data.user;
    if (data.token) {
      await setStoredAuthToken(data.token);
    }
    window.localStorage.setItem('cached_user', JSON.stringify(user));
    // Legacy accounts may have a password shorter than the current 12-char
    // policy. They can sign in fine, but surface a gentle nudge to upgrade.
    if (data.password_upgrade_required) {
      showToast('For better security, consider setting a stronger password (12+ characters).', 'warning');
    }
    // If E2EE keys exist, decrypt and store the private key locally
    if (user.encrypted_private_key && user.email) {
      try {
        const pbkdf2Key = await E2EECrypto.deriveKeyFromPassword(password, user.email);
        const privateKey = await E2EECrypto.decryptPrivateKey(
          user.encrypted_private_key.ciphertext,
          user.encrypted_private_key.iv,
          pbkdf2Key
        );
        const jwk = await E2EECrypto.exportKeyToJwk(privateKey);
        window.localStorage.setItem('e2ee_private_key', JSON.stringify(jwk));
      } catch (cryptoErr) {
        console.error('Failed to decrypt private key:', cryptoErr);
        showToast('Security warning: Could not decrypt your E2EE chat keys. Your chat history may be unreadable on this device.', 'error');
      }
    } else {
      // Clear any old key if logging in as a legacy user
      window.localStorage.removeItem('e2ee_private_key');
    }
    window.location.replace('discover.html');
  }

  document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();

    const usernameOrEmail = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;

    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Signing In...';
    loginErrEl.classList.add('hidden');

    try {
      const data = await apiCall('/api/users/login', 'POST', { usernameOrEmail, password });
      if (data.success) {
        await finishLogin(data, password);
      }
    } catch (err) {
      console.error(err);
      loginErrEl.textContent = err.message || 'Incorrect credentials';
      loginErrEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  };

  // ===== STAGE 1: Send Signup Email (Verification link via Brevo) =====
  document.getElementById('form-email').onsubmit = async (e) => {
    e.preventDefault();
    const email = inputEmail.value.trim().toLowerCase();
    const domain = email.split('@')[1];

    // Client-side validation — UX mirror only. The server is the authoritative
    // source of truth (ALLOWED_EMAIL_DOMAINS in server.js); this list must stay
    // in sync with it and is never a security boundary.
    const allowedDomains = [
      'rishihood.edu.in',
      'vitbhopal.ac.in',
      'nst.rishihood.edu.in',
      'psy.rishihood.edu.in',
      'som.rishihood.edu.in',
      'sod.rishihood.edu.in',
      'soh.rishihood.edu.in'
    ];
    if (!domain || !allowedDomains.includes(domain)) {
      errEl.textContent = 'Invalid email';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');

    const btn = document.getElementById('btn-send-otp');
    btn.disabled = true;
    btn.textContent = 'Sending link...';

    try {
      const data = await apiCall('/api/auth/send-verification-email', 'POST', { email });
      if (data && data.success) {
        currentEmail = email;
        otpEmailDisplay.textContent = email;
        showStage(stageOtp);
      } else {
        errEl.textContent = (data && data.error) ? data.error : 'Failed to send verification link';
        errEl.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
      errEl.textContent = err.message || 'Failed to send verification link';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Verification Email';
    }
  };

  // ===== Check Verification Token on page load =====
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');

  // The server embeds the email inside the base64url token as the first
  // colon-delimited segment (format: email:expiry:hmac). We decode it here
  // so the flow works even when ?email= is absent from the URL (which is
  // always the case — the server never appends ?email= to the verify link).
  let emailParam = urlParams.get('email');
  if (token && !emailParam) {
    try {
      const decoded = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
      emailParam = decoded.split(':')[0] || null;
    } catch (_) { /* malformed token — let the server reject it */ }
  }

  if (token && emailParam) {
    showStage(stageOtp);
    otpEmailDisplay.textContent = emailParam;
    // Show loading indicator while verifying
    const verifyBtn = document.getElementById('btn-verify-token');
    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying...';
    }

    // Auto-verify token (server only needs the token; email is decoded from it)
    try {
      const data = await apiCall('/api/auth/verify-token', 'POST', { token });
      if (data.success) {
        currentEmail = data.email || emailParam;
        if (data.token) {
          await setStoredAuthToken(data.token);
        }
        if (data.user) {
          window.localStorage.setItem('cached_user', JSON.stringify(data.user));
        }
        if (data.isNewUser) {
          showStage(stageProfile);
          document.getElementById('profile-username').focus();
        } else {
          // Existing user — session is now set, redirect to app
          window.location.replace('discover.html');
        }
      }
    } catch (err) {
      console.error(err);
      showToast('Verification link is invalid or has expired.', 'error');
      showStage(stageLogin);
    } finally {
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify Email';
      }
    }
  }

  // ===== STAGE 3: Complete Profile (new users) =====
  const profileGender = document.getElementById('profile-gender');
  const avatarPickerContainer = document.getElementById('avatar-picker-container');
  const avatarGrid = document.getElementById('avatar-grid');
  const profileAvatarInput = document.getElementById('profile-avatar');

  profileGender.onchange = () => {
    const gender = profileGender.value;
    avatarGrid.innerHTML = '';
    profileAvatarInput.value = '';
    
    if (!gender) {
      avatarPickerContainer.classList.add('hidden');
      return;
    }
    
    avatarPickerContainer.classList.remove('hidden');
    let avatars = [];
    if (gender === 'male') {
      for (let i = 1; i <= 25; i++) avatars.push(`male_${String(i).padStart(2, '0')}`);
    } else if (gender === 'female') {
      for (let i = 1; i <= 30; i++) avatars.push(`female_${String(i).padStart(2, '0')}`);
    } else {
      for (let i = 1; i <= 30; i++) {
        avatars.push(`female_${String(i).padStart(2, '0')}`);
      }
      for (let i = 1; i <= 25; i++) {
        avatars.push(`male_${String(i).padStart(2, '0')}`);
      }
    }

    avatars.forEach(av => {
      const wrapper = document.createElement('div');
      wrapper.className = 'aspect-square rounded-lg overflow-hidden border border-outline-variant/30 hover:border-primary/50 cursor-pointer transition-all flex items-center justify-center p-1 bg-surface-container';
      // av is like 'female_02' — resolve to subdirectory webp path
      const avParts = av.match(/^(male|female)_(\d+)$/);
      const avSrc = avParts
        ? `/avatars/${avParts[1]}/${av}/idle.webp`
        : `/avatars/${av}.webp`;
      wrapper.innerHTML = `<img src="${avSrc}" loading="lazy" decoding="async" class="w-full h-full object-cover">`;      wrapper.onclick = () => {
        avatarGrid.querySelectorAll('.aspect-square').forEach(el => el.classList.remove('border-primary', 'border-2', 'ring-2', 'ring-primary/20'));
        wrapper.classList.add('border-primary', 'border-2', 'ring-2', 'ring-primary/20');
        profileAvatarInput.value = av;
      };
      avatarGrid.appendChild(wrapper);
    });
  };

  document.getElementById('form-profile').onsubmit = async (e) => {
    e.preventDefault();

    const username = document.getElementById('profile-username').value.trim();
    const password = document.getElementById('profile-password').value;
    const gender = profileGender.value;
    const bio = document.getElementById('profile-bio').value.trim();
    const hobbiesStr = document.getElementById('profile-hobbies').value;
    const avatar = profileAvatarInput.value;

    if (!avatar) {
      document.getElementById('profile-error').textContent = 'Please select an avatar';
      document.getElementById('profile-error').classList.remove('hidden');
      return;
    }

    const pwStrengthErr = getPasswordStrengthError(password);
    if (pwStrengthErr) {
      document.getElementById('profile-error').textContent = pwStrengthErr;
      document.getElementById('profile-error').classList.remove('hidden');
      return;
    }

    let hobbies = [];
    if (hobbiesStr) {
      hobbies = hobbiesStr.split(',').map(s => s.trim()).filter(Boolean);
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Creating...';
    document.getElementById('profile-error').classList.add('hidden');

    try {
      // 1. Generate E2EE ECDH Keypair
      const keypair = await E2EECrypto.generateECDHKeypair();
      
      // 2. Derive local key from password to encrypt private key
      const pbkdf2Key = await E2EECrypto.deriveKeyFromPassword(password, currentEmail);
      const encryptedPrivateKey = await E2EECrypto.encryptPrivateKey(keypair.privateKey, pbkdf2Key);
      
      // 3. Export public key as JWK
      const publicKeyJwk = await E2EECrypto.exportKeyToJwk(keypair.publicKey);
      
      // 4. Save raw private key JWK in local storage for the current session
      const privateKeyJwk = await E2EECrypto.exportKeyToJwk(keypair.privateKey);
      window.localStorage.setItem('e2ee_private_key', JSON.stringify(privateKeyJwk));

      // 5. Submit profile fields and E2EE keys to server
      const data = await apiCall('/api/auth/complete-profile', 'POST', {
        email: currentEmail,
        username,
        password,
        gender,
        bio,
        hobbies,
        avatar,
        public_key: publicKeyJwk,
        encrypted_private_key: encryptedPrivateKey
      });
      if (data && data.user) {
        if (data.token) {
          await setStoredAuthToken(data.token);
        }
        window.localStorage.setItem('cached_user', JSON.stringify(data.user));
      }
      window.location.replace('discover.html');
    } catch (err) {
      document.getElementById('profile-error').textContent = err.message || 'Failed to initialize E2EE keys';
      document.getElementById('profile-error').classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Profile';
    }
  };

  // ===== FORGOT PASSWORD MODAL HANDLERS =====
  const forgotModal = document.getElementById('forgot-password-modal');
  const btnForgotPassword = document.getElementById('btn-forgot-password');
  const forgotCloseBtn = document.getElementById('forgot-close-btn');
  const forgotFormStep1 = document.getElementById('forgot-form-step1');
  const forgotFormStep2 = document.getElementById('forgot-form-step2');
  const forgotErr1 = document.getElementById('forgot-error-1');
  const forgotErr2 = document.getElementById('forgot-error-2');

  if (btnForgotPassword) {
    btnForgotPassword.onclick = () => {
      forgotModal.classList.remove('hidden');
      forgotModal.setAttribute('aria-hidden', 'false');
      document.getElementById('forgot-email').focus();
    };
  }

  // Helper to close and fully reset the modal
  function closeForgotModal() {
    forgotModal.classList.add('hidden');
    forgotModal.setAttribute('aria-hidden', 'true');
    forgotFormStep1.reset();
    forgotFormStep2.reset();
    forgotFormStep1.classList.remove('hidden');
    forgotFormStep2.classList.add('hidden');
    forgotErr1.classList.add('hidden');
    forgotErr2.classList.add('hidden');
  }

  if (forgotCloseBtn) {
    forgotCloseBtn.onclick = closeForgotModal;
  }

  // BUG FIX: Backdrop click to dismiss modal (tap outside the panel)
  if (forgotModal) {
    forgotModal.addEventListener('click', (e) => {
      if (e.target === forgotModal) closeForgotModal();
    });
  }

  if (forgotFormStep1) {
    forgotFormStep1.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email').value.trim();
      forgotErr1.classList.add('hidden');

      const btn = document.getElementById('btn-forgot-send');
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span> Sending...';

      try {
        const res = await apiCall('/api/auth/forgot-password/send-code', 'POST', { email });
        document.getElementById('forgot-sent-email').textContent = email;
        forgotFormStep1.classList.add('hidden');
        forgotFormStep2.classList.remove('hidden');
        document.getElementById('forgot-otp').focus();
      } catch (err) {
        forgotErr1.textContent = err.message || 'Failed to send verification code';
        forgotErr1.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-lg">send</span> Send Verification Code';
      }
    };
  }

  // BUG FIX: Resend code — go back to step 1 and auto-submit to get a fresh OTP
  const btnForgotResend = document.getElementById('btn-forgot-resend');
  if (btnForgotResend) {
    btnForgotResend.addEventListener('click', () => {
      // Reset step 2 and show step 1 again
      forgotFormStep2.reset();
      forgotFormStep2.classList.add('hidden');
      forgotErr2.classList.add('hidden');
      forgotFormStep1.classList.remove('hidden');
      // Auto-submit step 1 to resend the code cross-browser
      if (typeof forgotFormStep1.requestSubmit === 'function') {
        forgotFormStep1.requestSubmit();
      } else {
        forgotFormStep1.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });
  }

  if (forgotFormStep2) {
    forgotFormStep2.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email').value.trim();
      const otp = document.getElementById('forgot-otp').value.trim();
      const newPassword = document.getElementById('forgot-new-password').value;
      const confirmPassword = document.getElementById('forgot-confirm-password').value;

      forgotErr2.classList.add('hidden');

      if (!otp || otp.length !== 6 || !/^[0-9]{6}$/.test(otp)) {
        forgotErr2.textContent = 'Please enter the 6-digit numeric verification code';
        forgotErr2.classList.remove('hidden');
        return;
      }

      const pwStrengthErr = getPasswordStrengthError(newPassword);
      if (pwStrengthErr) {
        forgotErr2.textContent = pwStrengthErr;
        forgotErr2.classList.remove('hidden');
        return;
      }

      if (newPassword !== confirmPassword) {
        forgotErr2.textContent = 'Passwords do not match';
        forgotErr2.classList.remove('hidden');
        return;
      }

      const btn = document.getElementById('btn-forgot-reset');
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span> Resetting...';

      try {
        // Re-encrypt the E2EE private key with the new password so chat history
        // stays recoverable after the password reset.
        const e2eePayload = await reencryptE2EEKeysForNewPassword(newPassword, email);
        const res = await apiCall('/api/auth/forgot-password/reset', 'POST', {
          email,
          otp,
          newPassword,
          encrypted_private_key: e2eePayload.encrypted_private_key,
          public_key: e2eePayload.public_key
        });

        if (res.token) {
          // Persist a freshly minted private key ONLY after the server accepted
          // the reset, so a failed attempt can't desync the local keypair from
          // the server's stored public key.
          if (e2eePayload.privateKeyJwk) {
            window.localStorage.setItem('e2ee_private_key', JSON.stringify(e2eePayload.privateKeyJwk));
          }
          await setStoredAuthToken(res.token);
        }
        if (res.user) {
          window.localStorage.setItem('cached_user', JSON.stringify(res.user));
        }
        // NOTE: no local key cleanup needed here. If a local key existed, the
        // helper re-encrypted THAT SAME keypair for the server, so the raw
        // local JWK remains valid. If none existed, a fresh matching keypair
        // was minted and persisted above only after server confirmation.

        window.location.replace('discover.html');
      } catch (err) {
        forgotErr2.textContent = err.message || 'Failed to reset password';
        forgotErr2.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-lg">check_circle</span> Reset Password & Sign In';
      }
    };
  }
});
