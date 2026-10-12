/* Eatswada native Android push bridge.
 * Registers FCM device tokens against the existing authenticated API.
 * Android OS notification payloads handle background delivery; local
 * notifications add sound/vibration for pushes received while foregrounded.
 */
(function () {
  'use strict';
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

  const plugins = cap.Plugins || {};
  const Push = plugins.PushNotifications;
  const Local = plugins.LocalNotifications;
  if (!Push) {
    console.error('[Eatswada native push] Capacitor PushNotifications plugin is unavailable.');
    return;
  }

  const ROLE = 'rider';
  const API_ORIGIN = ROLE === 'vendor'
    ? (window.EATSWADA_CONFIG?.API_ORIGIN || 'https://api.eatswada.com')
    : 'https://api.eatswada.com';
  const API_BASE = API_ORIGIN.replace(/\/+$/, '') + '/api';
  const TOKEN_KEY = ROLE === 'vendor' ? 'nearbite_vendor_token' : 'riderToken';
  const CHANNEL_ID = 'eatswada_orders';

  function getAuthToken() { return localStorage.getItem(TOKEN_KEY); }

  async function registerToken(token) {
    const jwt = getAuthToken();
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
      console.error('[Eatswada native push] Device token registration failed:', error.message);
    }
  }

  function notificationId(data) {
    const value = String(data?.orderId || data?.applicationId || data?.type || Date.now());
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    return Math.abs(hash) || 1;
  }

  async function alertForeground(notification) {
    const data = notification?.data || {};
    const title = notification?.title || data.title || 'Eatswada order alert';
    const body = notification?.body || data.body || 'A new update needs your attention.';
    if (Local?.schedule) {
      try {
        await Local.schedule({ notifications: [{
          id: notificationId(data),
          title, body, channelId: CHANNEL_ID, sound: 'default',
          schedule: { at: new Date(Date.now() + 250) },
          extra: data
        }] });
        return;
      } catch (error) {
        console.warn('[Eatswada native push] Local notification failed:', error.message);
      }
    }
    try { navigator.vibrate?.([400, 200, 400]); } catch (_) {}
  }

  async function setup() {
    try {
      if (Local?.createChannel) await Local.createChannel({
        id: CHANNEL_ID, name: 'Eatswada order alerts',
        description: 'Important order and delivery updates',
        importance: 5, sound: 'default', vibration: true, visibility: 1
      }).catch(() => {});
      if (Push.createChannel) await Push.createChannel({
        id: CHANNEL_ID, name: 'Eatswada order alerts',
        description: 'Important order and delivery updates',
        importance: 5, sound: 'default', vibration: true, visibility: 1,
        lights: true, lightColor: '#D71945'
      }).catch(() => {});

      await Push.addListener('registration', event => registerToken(event?.value));
      await Push.addListener('registrationError', event =>
        console.error('[Eatswada native push] Registration error:', event?.error || 'unknown'));
      await Push.addListener('pushNotificationReceived', notification => {
        alertForeground(notification).catch(() => {});
        window.dispatchEvent(new CustomEvent('eatswada:push-received', { detail: notification }));
      });
      await Push.addListener('pushNotificationActionPerformed', action => {
        window.dispatchEvent(new CustomEvent('eatswada:push-opened', {
          detail: action?.notification?.data || {}
        }));
      });

      const permission = await Push.requestPermissions();
      if (permission.receive !== 'granted') {
        console.warn('[Eatswada native push] Notification permission not granted.');
        return;
      }
      await Push.register();
    } catch (error) {
      console.error('[Eatswada native push] Setup failed:', error?.message || error);
    }
  }

  // The dashboard only runs this after login; if token arrives later, retry briefly.
  if (getAuthToken()) setup();
  else {
    const timer = setInterval(() => {
      if (!getAuthToken()) return;
      clearInterval(timer);
      setup();
    }, 800);
    setTimeout(() => clearInterval(timer), 30000);
  }
})();
