// Regression tests for the backend-aligned upgrade. Every rule here was
// verified against the live backend source (controllers/riderController.js,
// services/orderPaymentView.js, services/riderEarningService.js, routes/
// riderRoutes.js, models/Order.js). Pure rules only — no browser, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import L from '../rider-logic.js';
import { extractInlineScripts } from '../scripts/check-inline-scripts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const indexScript = () => extractInlineScripts(read('index.html')).join('\n');

/* ---- Authoritative payment view (services/orderPaymentView.js) ------------- */

test('paymentDoorstep prefers the backend payment view over local derivation', () => {
  // A partial-COD order: ₹100 advance paid online, ₹150 cash still due. The raw
  // order total is ₹250 — showing that as cash to collect would overcharge.
  const order = {
    paymentMethod: 'COD', total: 250,
    payment: {
      method: 'cod', isCod: true, isPartialCod: true, orderTotal: 250,
      advanceRequired: 100, advancePaid: 100, advanceStatus: 'paid',
      cashToCollect: 150, cashCollected: false,
      label: '₹100 paid online · collect ₹150 cash', blocksDelivery: false, blockReason: '',
    },
  };
  const p = L.paymentDoorstep(order);
  assert.equal(p.isCod, true);
  assert.equal(p.amount, 150, 'the cash to collect must be the balance, not the total');
  assert.equal(p.isPartialCod, true);
  assert.equal(p.advancePaid, 100);
  assert.match(p.banner, /₹150/);
  assert.match(p.confirmationLabel, /₹150/);
  assert.equal(p.source, 'backend');
});

test('paymentDoorstep surfaces the backend block on an unpaid COD advance', () => {
  const order = {
    paymentMethod: 'COD', total: 250,
    payment: {
      method: 'cod', isCod: true, isPartialCod: true, orderTotal: 250,
      advanceRequired: 100, advancePaid: 0, advanceStatus: 'pending',
      cashToCollect: 150, cashCollected: false,
      label: '₹100 advance due online · then ₹150 cash on delivery',
      blocksDelivery: true, blockReason: 'The customer advance has not been paid; delivery cannot proceed.',
    },
  };
  const p = L.paymentDoorstep(order);
  assert.equal(p.blocksDelivery, true);
  assert.match(p.blockReason, /advance has not been paid/);
});

test('paymentDoorstep still derives COD locally when the payment view is absent', () => {
  const p = L.paymentDoorstep({ paymentMethod: 'COD', total: 249.5 });
  assert.equal(p.isCod, true);
  assert.equal(p.amount, 249.5);
  assert.equal(p.source, 'local');
  assert.equal(p.blocksDelivery, false);
  assert.equal(p.banner, '💵 CASH ON DELIVERY: COLLECT ₹249.50 FROM CUSTOMER');
});

/* ---- Pickup code (POST /verify-pickup-code) -------------------------------- */

test('pickupHandover reports whether the code was already verified', () => {
  const pending = L.pickupHandover({ pickupCodeRequired: true });
  assert.equal(pending.requiresCode, true);
  assert.equal(pending.verified, false);
  assert.equal(pending.display, '', 'the code is never sent to the client');
  const done = L.pickupHandover({ pickupCodeRequired: true, pickupCodeVerifiedAt: '2026-03-01T10:00:00Z' });
  assert.equal(done.verified, true);
  // An order with no code requirement never asks the rider for one.
  const plain = L.pickupHandover({});
  assert.equal(plain.requiresCode, false);
  assert.equal(plain.codeRequired, false);
});

/* ---- Weekly incentive (GET /riders/earnings weeklyIncentive) ---------------- */

test('backendWeeklyIncentive reads the value the backend already computed', () => {
  assert.deepEqual(L.backendWeeklyIncentive({ weeklyIncentive: 150 }), { amount: 150, source: 'backend', deliveries: null });
  const inner = L.backendWeeklyIncentive({ thisWeek: { incentive: 50, deliveries: 12 } });
  assert.equal(inner.amount, 50);
  assert.equal(inner.source, 'backend');
  assert.equal(inner.deliveries, 12);
  // A backend that returns zero is authoritative too — not "missing".
  assert.equal(L.backendWeeklyIncentive({ weeklyIncentive: 0 }).amount, 0);
  // No value at all falls back to the derived ladder.
  assert.equal(L.backendWeeklyIncentive({ thisWeek: { deliveries: 4 } }).amount, null);
});

test('incentiveDisplay shows the confirmed amount or a labelled target', () => {
  const confirmed = L.incentiveDisplay(L.weeklyIncentive(12), 50, n => '₹' + n);
  assert.equal(confirmed.amountText, '₹50');
  assert.equal(confirmed.confirmed, true);
  assert.match(confirmed.earnedText, /confirmed by Eatswada/);
  assert.equal(confirmed.approximate, false);

  const target = L.incentiveDisplay(L.weeklyIncentive(12), null, n => '₹' + n);
  assert.equal(target.approximate, true);
  assert.equal(target.confirmed, false);
  assert.match(target.earnedText, /approximate/);
});

/* ---- Per-order earning breakdown (models/Order.riderEarningBreakdown) ------ */

test('earningBreakdown reads the frozen nested riderEarningBreakdown first', () => {
  // Exactly the shape the backend freezes on the order.
  const b = L.earningBreakdown({
    riderEarning: 60,
    riderWaitTimeMinutes: 9,
    riderEarningBreakdown: { basePay: 25, distancePay: 10, rainSurgeBonus: 15, waitTimePay: 5, tip: 5, total: 60 },
  });
  assert.deepEqual(b.lines.map(l => l.value), [25, 10, 15, 5, 5]);
  assert.equal(b.lines[3].hint, '9 mins waited');
  assert.equal(b.complete, true);
  assert.equal(b.componentSum, 60);
  assert.equal(b.total, 60);
});

test('earningBreakdown falls back to flat fields when no frozen split exists', () => {
  const b = L.earningBreakdown({ riderEarning: 40, baseDeliveryPay: 25 });
  assert.equal(b.lines[0].value, 25);
  assert.equal(b.lines[1].value, null);
  assert.equal(b.complete, false);
  assert.equal(L.earningBreakdown({ total: 500 }).hasAny, false);
});

/* ---- Order reference (models/Order.orderNumber / shipmentId) --------------- */

test('the dashboard identifies orders by orderNumber, the real backend field', () => {
  const code = indexScript();
  // models/Order.js exposes orderNumber and shipmentId; the raw document has no
  // publicOrderId/shortId, so orderRef must read the real fields (normalize() may
  // still synthesise a local alias for display fallbacks).
  assert.match(code, /function orderRef\(o\)\{return o\.orderNumber\|\|o\.shipmentId/);
  assert.match(code, /publicOrderId:o\.publicOrderId\|\|o\.orderNumber\|\|''/);
});

test('the extras tab also identifies orders by orderNumber', () => {
  const src = read('rider-extras.js');
  assert.match(src, /o\.orderNumber\|\|o\.shipmentId/);
  assert.ok(!/publicOrderId/.test(src));
});

test('the extras COD cash total uses the partial-COD balance, not the order total', () => {
  const src = read('rider-extras.js');
  assert.match(src, /RiderLogic\.paymentDoorstep/);
  assert.match(src, /p\.isCod\?Number\(p\.amount\|\|0\)/);
});

/* ---- Notification tap robustness ------------------------------------------- */

test('a notification tap refreshes before scrolling and never throws', () => {
  const code = indexScript();
  // The opened handler is async, refreshes when the order is unknown, and
  // guards the refresh so a network failure cannot break the listener.
  assert.match(code, /'eatswada:push-opened',async e=>/);
  assert.match(code, /if\(!known\(\)\)await refresh\(false\)/);
  assert.match(code, /try\{if\(!known\(\)\)await refresh\(false\)\}catch\{\}/);
  assert.match(code, /no longer in your list/);
});

test('a denied or unavailable notification permission never breaks the dashboard', () => {
  const code = indexScript();
  // Permission is only read, never assumed; the request is inside try/catch.
  assert.match(code, /Notification\.permission==='default'\)await Notification\.requestPermission\(\)/);
  assert.match(code, /try\{if\(Notification\.permission==='default'\)await Notification\.requestPermission\(\)\}catch\{\}/);
  // notify() is defensive for environments with no Notification API.
  assert.match(code, /function notify\(title,body\)\{try\{if\(Notification\.permission==='granted'\)/);
});

/* ---- Dashboard wiring (static assertions) ---------------------------------- */

test('the dashboard verifies the pickup code through the real endpoint', () => {
  const code = indexScript();
  assert.match(code, /'\/api\/riders\/orders\/'\+id\+'\/verify-pickup-code'/);
  assert.match(code, /JSON\.stringify\(\{pickupCode:code\}\)/);
  // The status PUT must never carry the pickup code or a photo URL.
  assert.ok(!/body\.pickupCode=/.test(code), 'the status PUT must not send the pickup code');
  assert.ok(!/pickupPhotoUrl/.test(code), 'no pickup-photo endpoint exists on the backend');
});

test('the dashboard never calls the removed pickup-photo endpoint', () => {
  assert.ok(!read('index.html').includes('pickup-photo'));
  assert.ok(!read('rider-logic.js').includes('pickupPhotoRequired'));
});

test('the dashboard reads the authoritative payment view and blocks unpaid advances', () => {
  const code = indexScript();
  assert.match(code, /pay\.blocksDelivery/);
  assert.match(code, /pay\.blockReason/);
  // The COD collect badge uses the resolved cash amount, not the raw total.
  assert.match(code, /payView\.isCod/);
  assert.match(code, /Collect \$\{money\(payView\.amount\)\}/);
});

test('the dashboard uses the backend weekly incentive and all-time earnings', () => {
  const code = indexScript();
  assert.match(code, /backendWeeklyIncentive/);
  assert.match(code, /earnings\?\.allTime\?\.earnings/);
  // Rain surge comes from the authoritative platform public-status snapshot.
  assert.match(code, /'\/api\/platform\/public-status'/);
  assert.match(code, /platformStatus\|\|profile/);
});

test('the cash card prefers the server cashInHand from the rider profile', () => {
  const code = indexScript();
  assert.match(code, /details\.cashInHand/);
  assert.match(code, /source==='server'/);
});

test('the dashboard still sends only verified rider endpoints', () => {
  const code = indexScript();
  for (const ep of [
    "'/api/riders/orders?page='",
    "'/api/riders/orders/'+id+'/status'",
    "'/api/riders/orders/'+otpOrderId+'/verify-otp'",
    "'/api/riders/orders/'+id+'/verify-pickup-code'",
    "'/api/riders/orders/'+issueOrderId+'/delivery-issue'",
    "'/api/riders/location'",
    "'/api/riders/status'",
    "'/api/riders/earnings'",
    "'/api/riders/profile'",
    "'/api/platform/public-status'",
    "'/api/notifications/unregister-token'",
  ]) {
    assert.ok(code.includes(ep), `dashboard must still call ${ep}`);
  }
  assert.ok(!/assign-rider|activeOnly=true|\/reject/.test(code));
});
