/* Native Android push registration for Eatswada Admin.
 * Background notifications are shown by Android/FCM; foreground messages
 * are converted into local notifications with sound and vibration.
 */
(function () {
  'use strict';
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;
  const plugins = cap.Plugins || {};
  const Push = plugins.PushNotifications;
  const Local = plugins.LocalNotifications;
  if (!Push) {
    console.error('[Eatswada native push] PushNotifications plugin is missing.');
    return;
  }
  const API_BASE = window.CONFIG?.API_BASE_URL || 'https://api.eatswada.com/api';
  const CHANNEL_ID = 'eatswada_orders';

  function getToken() {
    return window.AdminAuth?.getToken ? window.AdminAuth.getToken() : localStorage.getItem('nearbite_admin_token');
  }
  async function registerToken(token) {
    const jwt = getToken();
    if (!token || !jwt) return;
    try {
      const response = await fetch(API_BASE + '/notifications/register-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt },
        body: JSON.stringify({ token })
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      console.info('[Eatswada native push] Device token registered.');
    } catch (error) {
      console.error('[Eatswada native push] Token registration failed:', error.message);
    }
  }
  function notificationId(data) {
    const value = String(data?.orderId || data?.applicationId || data?.type || Date.now());
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    return Math.abs(hash) || 1;
  }
  async function alertInForeground(n) {
    const d = n?.data || {};
    const title = n?.title || d.title || 'Eatswada order alert';
    const body = n?.body || d.body || 'A new update needs your attention.';
    if (Local?.schedule) {
      try {
        await Local.schedule({ notifications: [{
          id: notificationId(d), title, body, channelId: CHANNEL_ID, sound: 'default',
          schedule: { at: new Date(Date.now() + 250) }, extra: d
        }] });
        return;
      } catch (e) { console.warn('[Eatswada native push] Local notification failed:', e.message); }
    }
    try { navigator.vibrate?.([400, 200, 400]); } catch (_) {}
  }
  async function setup() {
    try {
      if (Local?.createChannel) await Local.createChannel({
        id: CHANNEL_ID, name: 'Eatswada order alerts',
        description: 'Important Eatswada order updates', importance: 5,
        sound: 'default', vibration: true, visibility: 1
      }).catch(() => {});
      if (Push.createChannel) await Push.createChannel({
        id: CHANNEL_ID, name: 'Eatswada order alerts',
        description: 'Important Eatswada order updates', importance: 5,
        sound: 'default', vibration: true, visibility: 1,
        lights: true, lightColor: '#D71945'
      }).catch(() => {});
      await Push.addListener('registration', event => registerToken(event?.value));
      await Push.addListener('registrationError', event =>
        console.error('[Eatswada native push] Registration error:', event?.error || 'unknown'));
      await Push.addListener('pushNotificationReceived', n => {
        alertInForeground(n).catch(() => {});
        window.dispatchEvent(new CustomEvent('eatswada:push-received', { detail: n }));
      });
      await Push.addListener('pushNotificationActionPerformed', action => {
        const d = action?.notification?.data || {};
        if (d.type === 'admin_new_order') {
          window.location.hash = 'manage-orders';
          window.refreshAdminOrders?.();
        } else if (d.type === 'admin_new_application') {
          window.location.hash = 'vendor-applications';
          window.refreshVendorApplications?.();
        }
      });
      const permission = await Push.requestPermissions();
      if (permission.receive !== 'granted') {
        console.warn('[Eatswada native push] Notification permission not granted.');
        return;
      }
      await Push.register();
    } catch (e) {
      console.error('[Eatswada native push] Setup failed:', e?.message || e);
    }
  }
  if (getToken()) setup();
  else {
    const timer = setInterval(() => {
      if (!getToken()) return;
      clearInterval(timer);
      setup();
    }, 800);
    setTimeout(() => clearInterval(timer), 30000);
  }
})();
