// Notification Permission Banner
// Shows a dismissible banner when notification permissions are denied
// This helps users understand why they're not receiving notifications

function showNotificationPermissionBanner() {
  // Don't show banner if already dismissed in this session
  if (window.sessionStorage.getItem('notif_banner_dismissed') === 'true') return;

  // Check if banner already exists
  if (document.getElementById('notification-permission-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'notification-permission-banner';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #85431E 0%, #D39858 100%);
    color: white;
    padding: 16px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(133, 67, 30, 0.3);
    animation: slideDown 0.3s ease-out;
  `;

  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
      <div style="flex: 1;">
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">Enable Notifications</div>
        <div style="font-size: 13px; opacity: 0.95;">Get notified when you receive new messages</div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
      <button id="enable-notif-btn" style="
        background: white;
        color: #85431E;
        border: none;
        padding: 8px 16px;
        border-radius: 8px;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
        font-family: inherit;
      ">Enable</button>
      <button id="dismiss-notif-banner" style="
        background: transparent;
        color: white;
        border: none;
        padding: 8px;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
      ">×</button>
    </div>
  `;

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideDown {
      from { transform: translateY(-100%); }
      to { transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(banner);

  // Enable button handler
  document.getElementById('enable-notif-btn').addEventListener('click', async () => {
    if (window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('PushNotifications')) {
      const PushNotifications = window.Capacitor.Plugins.PushNotifications;
      try {
        const perm = await PushNotifications.requestPermissions();
        if (perm && (perm.receive === 'granted' || perm.display === 'granted')) {
          await PushNotifications.register();
          banner.remove();
          window.sessionStorage.setItem('notif_banner_dismissed', 'true');
          // Show success message
          showToast('✓ Notifications enabled!', 'success');
        } else {
          // User denied - show how to enable in settings
          showToast('Please enable notifications in your device settings', 'info');
        }
      } catch (e) {
        console.error('Failed to request notifications:', e);
        showToast('Could not enable notifications. Please check settings.', 'error');
      }
    }
  });

  // Dismiss button handler
  document.getElementById('dismiss-notif-banner').addEventListener('click', () => {
    banner.style.animation = 'slideUp 0.3s ease-out';
    setTimeout(() => banner.remove(), 300);
    window.sessionStorage.setItem('notif_banner_dismissed', 'true');
  });
}

// Check notification permission status and show banner if needed
async function checkAndShowNotificationBanner() {
  // Only for Capacitor native app
  if (!window.Capacitor || !window.Capacitor.isPluginAvailable || !window.Capacitor.isPluginAvailable('PushNotifications')) {
    return;
  }

  const PushNotifications = window.Capacitor.Plugins.PushNotifications;

  try {
    if (typeof PushNotifications.checkPermissions === 'function') {
      const perm = await PushNotifications.checkPermissions();

      // Show banner if permissions are denied or prompt (not yet asked)
      if (perm.receive === 'denied' || perm.receive === 'prompt') {
        // Wait a bit so user sees the main UI first
        setTimeout(showNotificationPermissionBanner, 2000);
      }
    }
  } catch (e) {
    console.warn('Could not check notification permissions:', e);
  }
}

// Simple toast notification
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    info: '#3b82f6'
  };

  toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: ${colors[type] || colors.info};
    color: white;
    padding: 12px 20px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10001;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    animation: toastIn 0.3s ease-out;
  `;
  toast.textContent = message;

  const toastStyle = document.createElement('style');
  toastStyle.textContent = `
    @keyframes toastIn {
      from { opacity: 0; transform: translateX(-50%) translateY(20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;
  document.head.appendChild(toastStyle);

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
