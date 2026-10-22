// Regression tests for the v1.2 production upgrade: surge, rejection cooldown,
// the COD cash ceiling, the 200 m pickup geofence, the wait-time/kitchen
// handshake, the pickup handover, doorstep payment, the per-order earning
// breakdown and the settlement ledger. Pure rules only — no browser, no network.
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

/* ---- Rain / peak surge ------------------------------------------------------ */

test('rainSurgeInfo is active only when the payload says so', () => {
  assert.equal(L.rainSurgeInfo({}, {}).active, false);
  assert.equal(L.rainSurgeInfo({ riderDetails: { isRainSurgeActive: false } }, {}).active, false);
  const fromOrder = L.rainSurgeInfo({}, { isRainSurgeActive: true, rainSurgeBonus: 20 });
  assert.equal(fromOrder.active, true);
  assert.equal(fromOrder.bonus, 20);
  assert.equal(fromOrder.text, '🌧️ Rain Surge Active: +₹20 bonus per delivery');
});

test('rainSurgeInfo never invents a bonus amount', () => {
  const noAmount = L.rainSurgeInfo({ riderDetails: { isRainSurgeActive: true } }, {});
  assert.equal(noAmount.active, true);
  assert.equal(noAmount.bonus, null);
  assert.match(noAmount.text, /surge bonus applies per delivery/);
});

/* ---- Rejection cooldown ---------------------------------------------------- */

test('rejectionWarning stays hidden for a rider with no rejections', () => {
  const w = L.rejectionWarning({});
  assert.equal(w.visible, false);
  assert.equal(w.message, '');
});

test('rejectionWarning shows the exact 2/3 wording from the spec', () => {
  const w = L.rejectionWarning({ consecutiveRejections: 2 });
  assert.equal(w.visible, true);
  assert.equal(w.remaining, 1);
  assert.equal(w.message, 'Rejections: 2/3 — Next rejection triggers 15m cooldown');
});

test('rejectionWarning honours a backend-supplied limit and cooldown', () => {
  const w = L.rejectionWarning({ consecutiveRejections: 1, rejectionLimit: 5, rejectionCooldownMinutes: 30 });
  assert.equal(w.message, 'Rejections: 1/5 — Next rejection triggers 30m cooldown');
  const maxed = L.rejectionWarning({ consecutiveRejections: 3 });
  assert.equal(maxed.remaining, 0);
  assert.match(maxed.message, /Limit reached/);
});

test('cooldownRemaining renders a live MM:SS countdown and expires cleanly', () => {
  const now = Date.parse('2026-03-01T10:00:00Z');
  const active = L.cooldownRemaining('2026-03-01T10:12:05Z', now);
  assert.equal(active.active, true);
  assert.equal(active.text, '⏸️ Cooldown Active: 12:05 remaining');
  assert.equal(L.cooldownRemaining('2026-03-01T09:59:00Z', now).active, false);
  assert.equal(L.cooldownRemaining(null, now).active, false);
  assert.equal(L.cooldownRemaining('not-a-date', now).active, false);
});

/* ---- COD cash ceiling ------------------------------------------------------ */

test('codCashStatus defaults the ceiling to ₹2,000 and flags the limit', () => {
  const below = L.codCashStatus(500);
  assert.equal(below.limit, 2000);
  assert.equal(below.reached, false);
  assert.equal(below.pct, 25);
  assert.equal(below.label, 'COD Cash in Hand: ₹500 / ₹2,000');
  assert.equal(below.warning, '');

  const at = L.codCashStatus(2000);
  assert.equal(at.reached, true);
  assert.equal(at.pct, 100);
  assert.match(at.warning, /COD Cash Limit Reached/);
  assert.match(at.warning, /Prepaid UPI orders still active/);
});

test('codCashStatus accepts a backend ceiling and clamps the bar', () => {
  const s = L.codCashStatus(900, 1000);
  assert.equal(s.limit, 1000);
  assert.equal(s.pct, 90);
  assert.equal(s.reached, false);
  assert.equal(L.codCashStatus(5000, 1000).pct, 100);
});

/* ---- 200 m pickup geofence ------------------------------------------------- */

test('geofenceStatus reports inside/outside the 200 m pickup zone', () => {
  assert.equal(L.geofenceStatus(120).inside, true);
  assert.equal(L.geofenceStatus(120).text, '📍 120m from restaurant — Inside Pickup Zone');
  assert.equal(L.geofenceStatus(340).inside, false);
  assert.equal(L.geofenceStatus(340).text, '📍 340m away — Move within 200m');
  assert.equal(L.geofenceStatus(null).known, false);
});

test('pickupGeofence reads restaurant.location.coordinates as [lng, lat]', () => {
  const order = { restaurant: { location: { coordinates: [88.7, 26.5] } } };
  const near = L.pickupGeofence(order, { lat: 26.5005, lng: 88.7 });
  assert.equal(near.known, true);
  assert.equal(near.inside, true);
  const far = L.pickupGeofence(order, { lat: 26.55, lng: 88.7 });
  assert.equal(far.inside, false);
  assert.ok(far.distance > 5000);
});

test('pickupGeofence degrades to unknown without coordinates', () => {
  assert.equal(L.pickupGeofence({}, { lat: 26.5, lng: 88.7 }).known, false);
  assert.equal(L.pickupGeofence({ restaurant: { location: { coordinates: [88.7, 26.5] } } }, null).known, false);
});

test('coordinatesOf never turns a missing coordinate into 0,0 (Null Island)', () => {
  assert.equal(L.coordinatesOf({ coordinates: [null, null] }), null);
  assert.equal(L.coordinatesOf({ lat: '', lng: '' }), null);
  assert.equal(L.coordinatesOf({ latitude: null, longitude: null }), null);
  assert.deepEqual(L.coordinatesOf({ lat: 26.5, lng: 88.7 }), { lat: 26.5, lng: 88.7 });
  assert.deepEqual(L.coordinatesOf({ coordinates: [88.7, 26.5] }), { lat: 26.5, lng: 88.7 });
  // A real 0,0 fix is still accepted (only absent values are rejected).
  assert.deepEqual(L.coordinatesOf({ lat: 0, lng: 0 }), { lat: 0, lng: 0 });
});

test('haversineMeters rejects non-numeric input', () => {
  assert.equal(L.haversineMeters(NaN, 1, 2, 3), null);
  assert.equal(Math.round(L.haversineMeters(26.5, 88.7, 26.5, 88.7)), 0);
});

/* ---- Wait time, kitchen readiness, handover -------------------------------- */

test('waitTimeInfo ticks up and flags the 7-minute compensation threshold', () => {
  const start = Date.parse('2026-03-01T10:00:00Z');
  const early = L.waitTimeInfo({ reachedRestaurantAt: '2026-03-01T10:00:00Z' }, start + 3 * 60000);
  assert.equal(early.text, '⏱️ Waiting at restaurant: 03:00');
  assert.equal(early.compensationApplies, false);
  assert.match(early.note, /applies after 7 minutes/);

  const late = L.waitTimeInfo({ reachedRestaurantAt: '2026-03-01T10:00:00Z' }, start + 8 * 60000 + 30000);
  assert.equal(late.text, '⏱️ Waiting at restaurant: 08:30');
  assert.equal(late.compensationApplies, true);
  assert.match(late.note, /8 min waited/);
});

test('waitTimeInfo is inactive without a reached-at timestamp', () => {
  const w = L.waitTimeInfo({});
  assert.equal(w.active, false);
  assert.equal(w.text, '');
});

test('kitchenReadyInfo switches to the packed-and-ready message', () => {
  assert.equal(L.kitchenReadyInfo({ isFoodReady: true }).ready, true);
  assert.equal(L.kitchenReadyInfo({ isFoodReady: true }).text, '🛍️ ORDER IS PACKED & READY AT COUNTER!');
  // A kitchen status that releases the order also counts as ready.
  assert.equal(L.kitchenReadyInfo({ status: 'waiting_for_rider' }).ready, true);
  assert.equal(L.kitchenReadyInfo({ status: 'assigned' }).ready, true);
});

test('kitchenReadyInfo shows the prep message and only a real ETA', () => {
  const noEta = L.kitchenReadyInfo({ status: 'preparing' });
  assert.equal(noEta.ready, false);
  assert.equal(noEta.text, '🍳 Kitchen is preparing order');
  const now = Date.parse('2026-03-01T10:00:00Z');
  const eta = L.kitchenReadyInfo({ status: 'preparing', estimatedReadyAt: '2026-03-01T10:04:30Z' }, now);
  assert.equal(eta.text, '🍳 Kitchen is preparing order (Est. ready: 04:30)');
});

test('pickupHandover exposes the 4-digit code, cutlery and validation', () => {
  const h = L.pickupHandover({ pickupCode: '4821', sendCutlery: true });
  assert.equal(h.code, '4821');
  assert.equal(h.display, '#4821');
  assert.equal(h.requiresCode, true);
  assert.equal(h.cutlery, true);
  assert.equal(h.cutleryLabel, 'Send cutlery');
  const empty = L.pickupHandover({});
  assert.equal(empty.display, '');
  assert.equal(empty.requiresCode, false);
  assert.equal(empty.cutlery, false);
});

test('isValidPickupCode requires exactly four digits', () => {
  assert.equal(L.isValidPickupCode('4821'), true);
  assert.equal(L.isValidPickupCode(' 4821 '), true);
  assert.equal(L.isValidPickupCode('482'), false);
  assert.equal(L.isValidPickupCode('48a1'), false);
  assert.equal(L.isValidPickupCode(''), false);
});

/* ---- Doorstep payment ------------------------------------------------------ */

test('paymentDoorstep flags COD with the exact collect wording', () => {
  const cod = L.paymentDoorstep({ paymentMethod: 'COD', total: 249.5 });
  assert.equal(cod.isCod, true);
  assert.equal(cod.banner, '💵 CASH ON DELIVERY: COLLECT ₹249.50 FROM CUSTOMER');
  assert.equal(cod.requiresCashConfirmation, true);
  assert.equal(cod.confirmationLabel, 'I have collected ₹249.50 in cash from the customer');
});

test('paymentDoorstep reassures on prepaid and never demands cash confirmation', () => {
  for (const method of ['ONLINE', 'UPI', 'PREPAID', undefined, '']) {
    const p = L.paymentDoorstep({ paymentMethod: method, total: 300 });
    assert.equal(p.isCod, false, `${method} must not be treated as COD`);
    assert.equal(p.banner, '✅ PREPAID ONLINE — DO NOT COLLECT CASH');
    assert.equal(p.requiresCashConfirmation, false);
  }
});

/* ---- Per-order earning breakdown ------------------------------------------- */

test('earningBreakdown lists every component from backend fields', () => {
  const b = L.earningBreakdown({
    riderEarning: 60, baseDeliveryPay: 25, distancePay: 10, rainSurgeBonus: 15,
    waitTimePay: 5, tipAmount: 5, riderWaitTimeMinutes: 9,
  });
  assert.deepEqual(b.lines.map(l => l.label), [
    'Base Delivery Pay', 'Distance Pay', 'Rain / Surge Bonus',
    'Restaurant Wait-Time Pay', 'Customer Tip (100%)',
  ]);
  assert.deepEqual(b.lines.map(l => l.value), [25, 10, 15, 5, 5]);
  assert.equal(b.lines[3].hint, '9 mins waited');
  assert.equal(b.complete, true);
  assert.equal(b.componentSum, 60);
  assert.equal(b.total, 60);
});

test('earningBreakdown marks missing components instead of inventing them', () => {
  const b = L.earningBreakdown({ riderEarning: 40, baseDeliveryPay: 25 });
  assert.equal(b.hasAny, true);
  assert.equal(b.complete, false);
  assert.equal(b.lines[0].value, 25);
  assert.equal(b.lines[1].value, null);
  assert.equal(b.lines[3].value, null);
  // The order total is never used as a rider earning.
  assert.equal(L.earningBreakdown({ total: 500 }).hasAny, false);
  assert.equal(L.earningBreakdown({}).hasAny, false);
});

/* ---- Settlement & ledger --------------------------------------------------- */

test('settlementSummary labels a payout due and a COD cash due correctly', () => {
  const due = L.settlementSummary({ totalEarnings: 1200, cashInHand: 400 });
  assert.equal(due.net, 800);
  assert.equal(due.tone, 'ok');
  assert.equal(due.label, 'Net Payout Due to You: +₹800');

  const owe = L.settlementSummary({ totalEarnings: 1200, cashInHand: 1500 });
  assert.equal(owe.net, -300);
  assert.equal(owe.tone, 'warn');
  assert.equal(owe.label, 'Net COD Cash Due to Admin: -₹300');
});

test('ledgerRows keeps only rows with a real amount or reference', () => {
  const rows = L.ledgerRows([
    { date: '2026-02-01', amount: 500, status: 'paid', utr: 'UTR123' },
    { amount: 250 },
    {},
    null,
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amountText, '₹500');
  assert.equal(rows[0].reference, 'UTR123');
  assert.equal(rows[1].amountText, '₹250');
  assert.equal(rows[1].reference, '');
  assert.deepEqual(L.ledgerRows(null), []);
});

/* ---- Shared money formatting ----------------------------------------------- */

test('rupees formats with Indian grouping and optional paise', () => {
  assert.equal(L.rupees(2000), '₹2,000');
  assert.equal(L.rupees(249.5, 2), '₹249.50');
  assert.equal(L.rupees(undefined), '₹0');
  assert.equal(L.rupees('1200'), '₹1,200');
});

/* ---- Dashboard wiring (static assertions) ---------------------------------- */

test('the dashboard sends the geofence, pickup and COD payload fields', () => {
  const code = indexScript();
  assert.match(code, /body\.lat=riderPos\.lat;body\.lng=riderPos\.lng/);
  assert.match(code, /body\.pickupCode=code/);
  assert.match(code, /body\.pickupPhotoUrl=photoUrl/);
  assert.match(code, /body\.codCashCollected=true/);
  // The pickup route stays the verified status endpoint.
  assert.match(code, /'\/api\/riders\/orders\/'\+id\+'\/status'/);
});

test('the COD confirmation is only required for cash orders', () => {
  const code = indexScript();
  // The gate reads the shared rule, and prepaid orders never gate the submit.
  assert.match(code, /pay\.requiresCashConfirmation&&!\$\('codConfirm'\)\.checked/);
  assert.match(code, /if\(pay\.requiresCashConfirmation\)body\.codCashCollected=true/);
});

test('the dashboard renders every upgrade panel container', () => {
  const html = read('index.html');
  for (const id of [
    'surgePill', 'rejectionWarn', 'cooldownBanner', 'locationHint', 'cashCard',
    'perOrderRows', 'settlementRows', 'settlementNet', 'ledgerRows',
    'otpPayBanner', 'codConfirmWrap', 'codConfirm', 'pickupModal', 'pickupSummary',
    'pickupCodeInput', 'pickupPhotoInput',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `${id} must exist in index.html`);
  }
});

test('the ORDER_READY push is handled with a distinct chime', () => {
  const code = indexScript();
  assert.match(code, /d\.type==='order_ready'\|\|d\.type==='ORDER_READY'/);
  assert.match(code, /orderReadyAlert/);
  const native = read('native-push.js');
  assert.match(native, /READY_TYPES/);
  assert.match(native, /order_ready/);
});

test('the COD cash card and settlement use the shared pure rules', () => {
  const code = indexScript();
  assert.match(code, /RL\.codCashStatus/);
  assert.match(code, /RL\.settlementSummary/);
  assert.match(code, /RL\.ledgerRows/);
  assert.match(code, /RL\.pickupGeofence/);
  assert.match(code, /RL\.waitTimeInfo/);
  assert.match(code, /RL\.kitchenReadyInfo/);
  assert.match(code, /RL\.rainSurgeInfo/);
  assert.match(code, /RL\.rejectionWarning/);
  assert.match(code, /RL\.cooldownRemaining/);
});

test('no inline script was added: all new logic lives in external modules', () => {
  // index.html still has exactly one inline block (the dashboard controller).
  assert.equal(extractInlineScripts(read('index.html')).length, 1);
  assert.equal(extractInlineScripts(read('login.html')).length, 1);
  assert.equal(extractInlineScripts(read('apply.html')).length, 1);
});
