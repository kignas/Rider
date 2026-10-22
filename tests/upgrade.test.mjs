// Regression tests for the production-grade upgrade. These are static/source
// assertions (no browser, no network), matching the style of pages.test.mjs.
// They lock in the fixes so a future edit cannot silently reintroduce them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractInlineScripts } from '../scripts/check-inline-scripts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const indexScript = () => extractInlineScripts(read('index.html')).join('\n');

test('the online/offline switch is actually wired to the verified status endpoint', () => {
  const html = read('index.html');
  const code = indexScript();
  // The control exists and has a click handler bound to toggleOnline().
  assert.ok(html.includes('id="onlineBtn"'));
  assert.match(code, /\$\('onlineBtn'\)\.onclick\s*=/, 'the header switch must have a click handler');
  assert.match(code, /toggleOnline\(/, 'the handler must call toggleOnline');
  // The handler reads the server-confirmed state, not a blind toggle.
  assert.match(code, /getAttribute\('aria-pressed'\)/);
  // And it still targets the verified endpoint with the isOnline payload.
  assert.match(code, /'\/api\/riders\/status'.*method:'PUT'/s);
  assert.match(code, /isOnline:on/);
});

test('the online switch is an accessible switch with a server-confirmed state', () => {
  const html = read('index.html');
  assert.match(html, /id="onlineBtn"[^>]*role="switch"/);
  assert.match(html, /id="onlineBtn"[^>]*aria-checked="false"/);
  const code = indexScript();
  assert.match(code, /aria-checked',on\?'true':'false'/);
  assert.match(code, /aria-label',on\?/);
});

test('web push setup is idempotent: one service-worker registration, one message handler', () => {
  const code = indexScript();
  // Guarded entry point.
  assert.match(code, /if\(__pushInit\)return __pushInit/);
  // Registration is memoised instead of re-run on every entry point.
  assert.match(code, /__swReg=__swReg\|\|navigator\.serviceWorker\.register/);
  // The FCM onMessage handler is attached at most once.
  assert.match(code, /if\(!__pushBound\)/);
  // Only one registerToken() call site exists.
  assert.equal((code.match(/notifications\/register-token/g) || []).length, 1);
});

test('the app never asks for notification permission without an order or user action', () => {
  const code = indexScript();
  // The old behaviour requested permission on the first pointerdown everywhere.
  assert.ok(
    !/pointerdown[\s\S]{0,120}Notification\.requestPermission/.test(code),
    'permission must not be requested from a generic first-tap handler'
  );
  // Requesting is still allowed where the rider acts: going online.
  assert.match(code, /Notification\.permission==='default'\)await Notification\.requestPermission\(\)/);
});

test('location is explained before the OS prompt', () => {
  const html = read('index.html');
  const code = indexScript();
  assert.ok(html.includes('id="locationHint"'), 'a plain-language location reason must be present');
  assert.match(html, /id="locationHint"[\s\S]{0,200}location/);
  // The hint hides once a fix is available.
  assert.match(code, /hint\.hidden\s*=\s*on/);
});

test('native background tracking is guarded so the web build is unaffected', () => {
  const code = indexScript();
  // The bridge is only started/stopped on native Android.
  assert.match(code, /window\.RiderBackgroundLocation/);
  assert.match(code, /isNativeAndroid\(\)/);
  // No unconditional call into the plugin.
  assert.ok(!/^\s*bg\.start\(\)/m.test(code), 'bg.start() must be behind the native guard');
  assert.ok(!/\bbg\.stop\(\)\s*;/m.test(code) || /if\(on\)bg\.start/.test(code));
});

test('login and apply pages use the Eatswada brand identity', () => {
  for (const f of ['login.html', 'apply.html']) {
    const html = read(f);
    assert.ok(html.includes('--brand:#690D27'), `${f} must use burgundy #690D27`);
    assert.ok(html.includes('content="#690D27"'), `${f} theme-color must be burgundy`);
    assert.ok(!html.includes('#D71945'), `${f} must not keep the old pink brand colour`);
    assert.ok(html.includes('--page:#FFFBF2'), `${f} must use the warm ivory canvas`);
  }
});

test('the dashboard keeps every verified endpoint and adds no invention', () => {
  const code = indexScript();
  for (const ep of [
    "'/api/riders/orders?page='",
    "'/api/riders/orders/'+id+'/status'",
    "'/api/riders/orders/'+otpOrderId+'/verify-otp'",
    "'/api/riders/orders/'+issueOrderId+'/delivery-issue'",
    "'/api/riders/location'",
    "'/api/riders/status'",
    "'/api/riders/earnings'",
    "'/api/riders/profile'",
    "'/api/notifications/unregister-token'",
  ]) {
    assert.ok(code.includes(ep), `dashboard must still call ${ep}`);
  }
  assert.ok(!/assign-rider|activeOnly=true|\/reject/.test(code));
});
