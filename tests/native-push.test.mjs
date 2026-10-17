import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Minimal Capacitor/localStorage stubs so the IIFE can run in Node.
function runBridge(html, { jwt, token }) {
  const listeners = {};
  const events = [];
  const store = {};
  if (jwt) store.riderToken = jwt;

  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: {
        PushNotifications: {
          addListener: async (name, cb) => { listeners[name] = cb; },
          requestPermissions: async () => ({ receive: 'granted' }),
          register: async () => {},
          createChannel: async () => {},
        },
        LocalNotifications: { createChannel: async () => {}, schedule: async () => {} },
      },
    },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    dispatchEvent: (e) => events.push(e),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    console,
    setInterval,
    clearInterval,
    setTimeout,
    navigator: {},
    fetch: async () => ({ ok: true, status: 200 }),
  };
  win.window = win;

  const fn = new Function('window', 'localStorage', 'console', 'setInterval', 'clearInterval', 'setTimeout', 'navigator', 'fetch', 'CustomEvent', html);
  // Stub the bridge's timers: the no-token path polls, which would otherwise
  // leave a 30s handle open and keep the test process alive.
  const noop = () => 0;
  fn(win, win.localStorage, console, noop, noop, noop, win.navigator, win.fetch, win.CustomEvent);
  // setup() is async; let its awaited plugin calls settle before asserting.
  return new Promise((resolve) => setImmediate(() => resolve({ listeners, events, store })));
}

const bridge = read('native-push.js');

test('native-push registers the device token under the authenticated rider', async () => {
  const { listeners, store } = await runBridge(bridge, { jwt: 'rider-jwt' });
  assert.ok(listeners.registration, 'registration listener must be attached');
  await listeners.registration({ value: 'fcm-token-1' });
  assert.equal(store.eatswada_rider_fcm_token, 'fcm-token-1');
});

test('native-push waits for a login instead of registering when unauthenticated', async () => {
  const { listeners, store } = await runBridge(bridge, { jwt: null });
  assert.equal(listeners.registration, undefined, 'must not register before login');
  assert.equal(store.eatswada_rider_fcm_token, undefined);
});

test('native-push re-dispatches received and opened notifications as window events', async () => {
  const { listeners, events } = await runBridge(bridge, { jwt: 'rider-jwt' });
  assert.ok(listeners.pushNotificationReceived);
  assert.ok(listeners.pushNotificationActionPerformed);
  await listeners.pushNotificationReceived({ data: { orderId: 'o1' } });
  await listeners.pushNotificationActionPerformed({ notification: { data: { orderId: 'o1' } } });
  const types = events.map((e) => e.type);
  assert.ok(types.includes('eatswada:push-received'));
  assert.ok(types.includes('eatswada:push-opened'));
});

test('native-push never contains private Firebase credentials', () => {
  for (const f of ['native-push.js', 'native-push-rider.js', 'firebase-messaging-sw.js']) {
    const src = read(f);
    assert.ok(!/private_key|serviceAccount|BEGIN PRIVATE KEY/.test(src), `${f} leaks credentials`);
  }
});
