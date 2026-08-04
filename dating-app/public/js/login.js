
document.addEventListener('DOMContentLoaded', async () => {
  // Check session; if logged in, redirect to /discover
  try {
    const data = await apiCall('/api/session');
    if (data.authenticated) {
      window.location.replace('discover.html');
      return;
    }
  } catch (err) {}

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
  document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();
    const usernameOrEmail = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Signing In...';
    loginErrEl.classList.add('hidden');

    try {
      const data = await apiCall('/api/users/login', 'POST', { usernameOrEmail, password });
      if (data.success) {
        const user = data.user;
        if (data.token) {
          window.localStorage.setItem('auth_token', data.token);
        }
        window.localStorage.setItem('cached_user', JSON.stringify(user));
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

    // Client-side validation
    const allowedDomains = [
      'rishihood.edu.in', 
      'vitbhopal.ac.in', 
      'nst.rishihood.edu.in', 
      'psy.rishihood.edu.in',
      'csds.rishihood.edu.in',
      'makers.rishihood.edu.in',
      'design.rishihood.edu.in',
      // Chandigarh University
      'cuchd.in',
      'cumail.in',
      // Amity University
      's.amity.edu'
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
      if (data.success) {
        currentEmail = email;
        otpEmailDisplay.textContent = email;
        showStage(stageOtp);
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
  const emailParam = urlParams.get('email');

  if (token && emailParam) {
    showStage(stageOtp);
    otpEmailDisplay.textContent = emailParam;
    // Show loading indicator while verifying
    const verifyBtn = document.getElementById('btn-verify-token');
    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying...';
    }
    
    // Auto-verify token
    try {
      const data = await apiCall('/api/auth/verify-token', 'POST', { token, email: emailParam });
      if (data.success) {
        currentEmail = emailParam;
        if (data.token) {
          window.localStorage.setItem('auth_token', data.token);
        }
        if (data.user) {
          window.localStorage.setItem('cached_user', JSON.stringify(data.user));
        }
        if (data.isNewUser) {
          showStage(stageProfile);
          document.getElementById('profile-username').focus();
        } else {
          // If already registered, redirect straight to discover since session is set
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
      wrapper.innerHTML = `<img src="/avatars/${av}.png" class="w-full h-full object-cover">`;
      wrapper.onclick = () => {
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
          window.localStorage.setItem('auth_token', data.token);
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
      document.getElementById('forgot-email').focus();
    };
  }

  if (forgotCloseBtn) {
    forgotCloseBtn.onclick = () => {
      forgotModal.classList.add('hidden');
      forgotFormStep1.reset();
      forgotFormStep2.reset();
      forgotFormStep1.classList.remove('hidden');
      forgotFormStep2.classList.add('hidden');
      forgotErr1.classList.add('hidden');
      forgotErr2.classList.add('hidden');
    };
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

  if (forgotFormStep2) {
    forgotFormStep2.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email').value.trim();
      const otp = document.getElementById('forgot-otp').value.trim();
      const newPassword = document.getElementById('forgot-new-password').value;
      const confirmPassword = document.getElementById('forgot-confirm-password').value;

      forgotErr2.classList.add('hidden');

      if (!otp || otp.length !== 6) {
        forgotErr2.textContent = 'Please enter the 6-digit verification code';
        forgotErr2.classList.remove('hidden');
        return;
      }

      if (newPassword.length < 6) {
        forgotErr2.textContent = 'Password must be at least 6 characters long';
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
        const res = await apiCall('/api/auth/forgot-password/reset', 'POST', {
          email,
          otp,
          newPassword
        });

        if (res.token) {
          window.localStorage.setItem('auth_token', res.token);
        }
        if (res.user) {
          window.localStorage.setItem('cached_user', JSON.stringify(res.user));
        }

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
