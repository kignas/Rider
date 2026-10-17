import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFile, extractInlineScripts } from '../scripts/check-inline-scripts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('every page inline script parses', () => {
  for (const f of ['index.html', 'login.html', 'apply.html']) {
    assert.ok(checkFile(path.join(root, f)) >= 1, `${f} should have an inline script`);
  }
});

test('rider-logic.js exposes itself as a browser global when not a module', () => {
  const src = read('rider-logic.js');
  const fakeWindow = {};
  const fn = new Function('globalThis', 'module', 'window', `${src}; return globalThis.RiderLogic;`);
  const api = fn(fakeWindow, undefined, fakeWindow);
  assert.ok(api && typeof api.validateApplication === 'function');
});

test('the dashboard uses the verified rider endpoints', () => {
  const html = read('index.html');
  assert.ok(html.includes("'/api/riders/orders?page='"));
  assert.ok(!html.includes('activeOnly=true'), 'activeOnly is not a backend parameter');
  assert.ok(html.includes("'/api/riders/orders/'+id+'/status'"));
  assert.ok(html.includes("'/api/riders/orders/'+otpOrderId+'/verify-otp'"));
  assert.ok(html.includes("'/api/riders/orders/'+issueOrderId+'/delivery-issue'"));
  assert.ok(html.includes("'/api/riders/location'"));
  assert.ok(html.includes("'/api/riders/status'"));
  assert.ok(html.includes("'/api/notifications/unregister-token'"));
});

test('the dashboard never invents a rider-assignment or rejection endpoint', () => {
  const html = read('index.html');
  assert.ok(!/assign-rider/.test(html), 'frontend must not assign riders');
  // No rejection action, button or endpoint — the backend has none for riders.
  assert.ok(!/data-action="reject/.test(html));
  assert.ok(!/\/reject/.test(html));
  assert.ok(!/rider-reject|rejectDelivery/.test(html));
});

test('the application page posts to the verified endpoint', () => {
  const html = read('apply.html');
  assert.ok(html.includes('https://api.eatswada.com'));
  assert.ok(html.includes('"/api/rider-applications"'));
  assert.ok(html.includes('/status?phone='));
  assert.ok(html.includes('rider-logic.js'));
});

test('the login page links to the application page', () => {
  const html = read('login.html');
  assert.ok(html.includes('./apply.html'));
  assert.ok(html.includes('Become a Delivery Partner'));
  // The existing login endpoint and session keys are preserved.
  assert.ok(html.includes('/api/auth/rider/login'));
  assert.ok(html.includes('riderToken'));
});

test('the Android build stages the new files', () => {
  const script = read('scripts/prepare-www.mjs');
  for (const f of ['apply.html', 'rider-logic.js', 'index.html', 'login.html']) {
    assert.ok(script.includes(`"${f}"`), `${f} must be staged into www/`);
  }
});

test('no secrets beyond the public Firebase web config are committed', () => {
  const files = ['index.html', 'apply.html', 'login.html', 'native-push.js', 'firebase-messaging-sw.js'];
  for (const f of files) {
    const src = read(f);
    assert.ok(!/serviceAccount|private_key|BEGIN PRIVATE KEY/.test(src), `${f} must not contain private keys`);
  }
});

test('the OTP is only sent through the verified verify-otp route', () => {
  const code = extractInlineScripts(read('index.html')).join('\n');
  assert.ok(code.includes('verify-otp'));
  assert.ok(!/deliveryOtpHash|deliveryOtpSalt/.test(code));
});
