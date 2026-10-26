// Runtime smoke test for the dashboard upgrade. jsdom is an optional dev
// dependency: when it is not installed this file skips instead of failing, so
// `npm test` stays green on a bare checkout while CI (which installs dev deps)
// exercises the real DOM wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch { /* optional dev dependency */ }

/* Boots index.html with rider-logic.js inlined and a stubbed API, then returns
   the live document plus any runtime errors the page produced. */
async function boot({ orders, profile, earnings, cash, payouts, position, rejectStatus }) {
  const logic = read('rider-logic.js');
  const extras = read('rider-extras.js');
  let html = read('index.html');
  html = html.replace('<script src="./rider-logic.js"></script>', `<script>${logic}</script>`);
  html = html.replace('<script src="./rider-extras.js"></script>', `<script>${extras}</script>`);

  const routes = {
    '/api/riders/profile': { success: true, data: profile },
    '/api/riders/orders?page=1&limit=20': { success: true, data: { orders, pages: 1 } },
    '/api/riders/orders/history?page=1&limit=20': { success: true, data: { orders: [], pages: 1, total: 0 } },
    '/api/riders/earnings': { success: true, data: earnings },
    '/api/riders/cash': { success: true, data: cash },
    '/api/riders/payouts': { success: true, data: payouts },
    '/api/riders/status': { success: true, data: {} },
    '/api/riders/location': { success: true, data: {} },
  };
  /* The OTP sheet first POSTs to verify-otp; without a mock the 404 aborts the
     flow before the status PUT we want to assert. */
  const verifyOtpPattern = /^\/api\/riders\/orders\/[^/]+\/verify-otp$/;
  const verifyPickupPattern = /^\/api\/riders\/orders\/[^/]+\/verify-pickup-code$/;

  const errors = [];
  const calls = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem('riderToken', 'test-jwt');
      window.localStorage.setItem('eatswada_rider_location_disclosed', '1');
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.fetch = async (url, opts = {}) => {
        const path = String(url).replace('https://api.eatswada.com', '');
        if (opts.method && opts.method !== 'GET') {
          calls.push({ path, method: opts.method, body: opts.body });
        }
        if (rejectStatus && /\/api\/riders\/orders\/[^/]+\/status$/.test(path) && opts.method === 'PUT') {
          return { ok: false, status: rejectStatus.status, json: async () => ({ success: false, message: rejectStatus.message }) };
        }
        const route = routes[path] || ((verifyOtpPattern.test(path) || verifyPickupPattern.test(path)) ? { success: true, data: {} } : null);
        return route
          ? { ok: true, status: 200, json: async () => route }
          : { ok: false, status: 404, json: async () => ({ success: false, message: 'not found' }) };
      };
      window.addEventListener('error', e => errors.push(String(e.message)));
    },
  });

  const { window } = dom;
  await new Promise(r => setTimeout(r, 300));
  if (position) {
    window.dispatchEvent(new window.CustomEvent('eatswada:background-location', { detail: position }));
    await new Promise(r => setTimeout(r, 250));
  }
  return { window, doc: window.document, errors, calls, close: () => window.close() };
}

/* Runs body(app) and guarantees the jsdom window is torn down afterwards, even
   when an assertion throws. Without this the dashboard's 1s/12s timers keep the
   Node process alive after a failure. */
async function withApp(options, body) {
  const app = await boot(options);
  try { await body(app); } finally { app.close(); }
}

const text = (doc, id) => (doc.getElementById(id) || {}).textContent || '';
const isHidden = (doc, id) => {
  const el = doc.getElementById(id);
  return !el || el.classList.contains('hidden');
};

const rest = (lng, lat) => ({ restaurant: { name: 'Curry House', location: { coordinates: [lng, lat] } } });
const COD_ORDER = {
  _id: 'a1'.repeat(12), riderStatus: 'picked_up', status: 'out_for_delivery',
  paymentMethod: 'COD', total: 500, riderEarning: 45,
  ...rest(88.7, 26.5), deliveryAddress: { line1: '5 Lake Rd', coordinates: [88.73, 26.53] },
};
const APPROACH_ORDER = {
  _id: 'd4'.repeat(12), riderStatus: 'accepted', status: 'confirmed',
  paymentMethod: 'ONLINE', total: 300, riderEarning: 40,
  ...rest(88.7, 26.5), deliveryAddress: { line1: '9 Park St', coordinates: [88.72, 26.52] },
};
const PREPAID_DELIVERY_ORDER = {
  _id: 'e5'.repeat(12), riderStatus: 'out_for_delivery', status: 'out_for_delivery',
  paymentMethod: 'ONLINE', total: 320, riderEarning: 38,
  ...rest(88.7, 26.5), deliveryAddress: { line1: '7 River Rd', coordinates: [88.75, 26.55] },
};
const COD_DELIVERY_ORDER = {
  _id: 'f6'.repeat(12), riderStatus: 'out_for_delivery', status: 'out_for_delivery',
  paymentMethod: 'COD', total: 500, riderEarning: 45,
  ...rest(88.7, 26.5), deliveryAddress: { line1: '5 Lake Rd', coordinates: [88.73, 26.53] },
};
const COUNTER_ORDER = {
  _id: 'b2'.repeat(12), riderStatus: 'reached_restaurant', status: 'preparing', isFoodReady: false,
  reachedRestaurantAt: new Date(Date.now() - 8 * 60000).toISOString(),
  estimatedReadyAt: new Date(Date.now() + 4 * 60000).toISOString(),
  pickupCode: '4821', sendCutlery: true, paymentMethod: 'ONLINE', total: 300,
  riderEarning: 60, baseDeliveryPay: 25, distancePay: 10, rainSurgeBonus: 15,
  waitTimePay: 5, tipAmount: 5, riderWaitTimeMinutes: 9,
  ...rest(88.7, 26.5), deliveryAddress: { line1: '3 Hill Rd', coordinates: [88.74, 26.54] },
};

const PROFILE = {
  name: 'Asha', phone: '9876543210',
  riderDetails: {
    isOnline: true, isRainSurgeActive: true, rainSurgeBonus: 15,
    consecutiveRejections: 2, rejectionLimit: 3, rejectionCooldownMinutes: 15,
    cooldownUntil: new Date(Date.now() + 12 * 60000 + 5000).toISOString(),
    codCashLimit: 2000,
  },
};
const EARNINGS = { today: { earnings: 480, deliveries: 6 }, thisWeek: { earnings: 2100, deliveries: 22 }, thisMonth: { earnings: 8000, deliveries: 90 }, totalEarnings: 2100 };
const PAYOUTS = { payouts: [{ date: '2026-02-01', amount: 500, status: 'paid', utr: 'UTR99887' }], deposits: [{ date: '2026-02-02', amount: 1000, reference: 'DEP-1' }] };

test('dashboard boots with no runtime errors and renders the shift banners', { skip: !JSDOM }, async () => {
  await withApp({ orders: [APPROACH_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 2000, codCashLimit: 2000 }, payouts: PAYOUTS }, async app => {
  assert.deepEqual(app.errors, []);
  assert.equal(isHidden(app.doc, 'surgePill'), false);
  assert.match(text(app.doc, 'surgePill'), /\+₹15 bonus per delivery/);
  assert.equal(isHidden(app.doc, 'rejectionWarn'), false);
  assert.match(text(app.doc, 'rejectionWarn'), /Rejections: 2\/3 — Next rejection triggers 15m cooldown/);
  assert.equal(isHidden(app.doc, 'cooldownBanner'), false);
  assert.match(text(app.doc, 'cooldownBanner'), /Cooldown Active: 12:\d\d remaining/);
  });
});

test('dashboard renders the COD cash ceiling card and settlement ledger', { skip: !JSDOM }, async () => {
  await withApp({ orders: [COD_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 2000, codCashLimit: 2000 }, payouts: PAYOUTS }, async app => {
  assert.deepEqual(app.errors, []);
  assert.equal(isHidden(app.doc, 'cashCard'), false);
  assert.match(text(app.doc, 'cashCard'), /₹2,000 \/ ₹2,000/);
  assert.match(text(app.doc, 'cashCard'), /COD Cash Limit Reached/);
  // Total earnings ₹2,100 - COD cash held ₹2,000 = +₹100 due to the rider.
  assert.match(text(app.doc, 'settlementNet'), /Net Payout Due to You: \+₹100/);
  assert.match(text(app.doc, 'ledgerRows'), /UTR99887/);
  assert.match(text(app.doc, 'ledgerRows'), /DEP-1/);
  });
});

test('the COD cash card is also shown on the Earnings tab', { skip: !JSDOM }, async () => {
  await withApp({ orders: [COD_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 2000, codCashLimit: 2000 }, payouts: PAYOUTS }, async app => {
  assert.deepEqual(app.errors, []);
  const { doc } = app;
  assert.equal(doc.getElementById('cashCardEarnings').classList.contains('hidden'), true);
  doc.querySelector('.nav button[data-view="earningsView"]').click();
  assert.equal(doc.getElementById('cashCardEarnings').classList.contains('hidden'), false);
  assert.match(doc.getElementById('cashCardEarnings').textContent, /COD Cash in Hand/);
  assert.match(doc.getElementById('cashCardEarnings').textContent, /COD Cash Limit Reached/);
  });
});

test('dashboard renders the 200 m geofence badge from a live GPS fix', { skip: !JSDOM }, async () => {
  await withApp({
    orders: [APPROACH_ORDER], profile: PROFILE, earnings: EARNINGS,
    cash: { cashInHand: 0 }, payouts: {},
    position: { lat: 26.5005, lng: 88.7, accuracy: 8, time: Date.now() },
  }, async app => {
  assert.deepEqual(app.errors, []);
  const html = app.doc.getElementById('orders').innerHTML + app.doc.getElementById('focusWrap').innerHTML;
  assert.match(html, /geofence inside/);
  assert.match(html, /\d+m from restaurant — Inside Pickup Zone/);
  });
});

test('dashboard renders the wait timer, kitchen prep and prepaid banner', { skip: !JSDOM }, async () => {
  await withApp({ orders: [COUNTER_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  assert.deepEqual(app.errors, []);
  const html = app.doc.getElementById('orders').innerHTML + app.doc.getElementById('focusWrap').innerHTML;
  assert.match(html, /Waiting at restaurant: 08:\d\d/);
  assert.match(html, /Kitchen is preparing order \(Est. ready: \d\d:\d\d\)/);
  assert.match(html, /Pickup ID #4821/);
  assert.match(html, /Send cutlery/);
  assert.match(html, /Base Delivery Pay/);
  assert.match(html, /Customer Tip \(100%\)/);
  assert.match(html, /9 mins waited/);
  });
});

test('a prepaid order shows the do-not-collect-cash banner', { skip: !JSDOM }, async () => {
  await withApp({ orders: [PREPAID_DELIVERY_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  assert.deepEqual(app.errors, []);
  const html = app.doc.getElementById('orders').innerHTML + app.doc.getElementById('focusWrap').innerHTML;
  assert.match(html, /PREPAID ONLINE — DO NOT COLLECT CASH/);
  });
});

test('dashboard shows the COD collect banner and breakdown on a cash order', { skip: !JSDOM }, async () => {
  await withApp({ orders: [COD_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  assert.deepEqual(app.errors, []);
  const html = app.doc.getElementById('orders').innerHTML + app.doc.getElementById('focusWrap').innerHTML;
  assert.match(html, /CASH ON DELIVERY: COLLECT ₹500\.00 FROM CUSTOMER/);
  });
});

test('the pocketbook extras render the COD cash bar and payout UTR', { skip: !JSDOM }, async () => {
  await withApp({ orders: [COD_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 2000, codCashLimit: 2000 }, payouts: PAYOUTS }, async app => {
  const { doc } = app;
  doc.querySelector('.nav button[data-view="earningsView"]').click();
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(app.errors, []);
  const extra = doc.getElementById('earnExtra').textContent;
  assert.match(extra, /COD Cash in Hand/);
  assert.match(extra, /₹2,000/);
  assert.match(extra, /COD Cash Limit Reached/);
  assert.match(extra, /UTR99887/);
  });
});

test('the COD confirmation toggle is required only for a cash order', { skip: !JSDOM }, async () => {
  await withApp({ orders: [COD_DELIVERY_ORDER, PREPAID_DELIVERY_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  assert.deepEqual(app.errors, []);
  const { doc } = app;
  // COD order: the sheet shows the collect banner and the cash confirmation.
  doc.querySelector(`[data-action^="otp"][data-id="${COD_DELIVERY_ORDER._id}"]`).click();
  assert.equal(doc.getElementById('codConfirmWrap').hidden, false);
  assert.match(doc.getElementById('codConfirmLabel').textContent, /I have collected ₹500\.00 in cash from the customer/);
  assert.match(doc.getElementById('otpPayBanner').textContent, /CASH ON DELIVERY/);
  doc.getElementById('closeOtp').click();
  // Prepaid order: no cash confirmation is ever demanded.
  doc.querySelector(`[data-action^="otp"][data-id="${PREPAID_DELIVERY_ORDER._id}"]`).click();
  assert.equal(doc.getElementById('codConfirmWrap').hidden, true);
  assert.match(doc.getElementById('otpPayBanner').textContent, /PREPAID ONLINE/);
  });
});

/* An order that is released by the kitchen and carries a 4-digit pickup code. */
const READY_ORDER = {
  _id: '17'.repeat(12), riderStatus: 'reached_restaurant', status: 'waiting_for_rider',
  isFoodReady: true, pickupCode: '4821', sendCutlery: true,
  reachedRestaurantAt: new Date(Date.now() - 10 * 60000).toISOString(),
  paymentMethod: 'ONLINE', total: 300, riderEarning: 55,
  ...rest(88.7, 26.5), deliveryAddress: { line1: '3 Hill Rd', coordinates: [88.74, 26.54] },
};

const putCalls = (calls, suffix) => calls.filter(c => c.method === 'PUT' && c.path.endsWith(suffix));

test('the pickup handover verifies the code then advances the status', { skip: !JSDOM }, async () => {
  await withApp({ orders: [READY_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  assert.deepEqual(app.errors, []);
  const { doc } = app;
  doc.querySelector(`[data-action^="pickup"][data-id="${READY_ORDER._id}"]`).click();
  assert.equal(doc.getElementById('pickupModal').classList.contains('show'), true);
  assert.equal(doc.getElementById('pickupCodeField').hidden, false);
  doc.getElementById('pickupCodeInput').value = '4821';
  doc.getElementById('confirmPickup').click();
  await new Promise(r => setTimeout(r, 200));
  // The counter code goes to the real verification endpoint (POST)...
  const verify = app.calls.find(c => c.method === 'POST' && c.path.endsWith(`/api/riders/orders/${READY_ORDER._id}/verify-pickup-code`));
  assert.ok(verify, 'the pickup code must POST to verify-pickup-code');
  assert.deepEqual(JSON.parse(verify.body), { pickupCode: '4821' });
  // ...and the status PUT carries only the transition, never the code.
  const call = putCalls(app.calls, `/api/riders/orders/${READY_ORDER._id}/status`)[0];
  assert.ok(call, 'the pickup must PUT to the status endpoint');
  assert.deepEqual(JSON.parse(call.body), { status: 'picked_up' });
  });
});

test('a bad pickup code is rejected before any request is sent', { skip: !JSDOM }, async () => {
  await withApp({ orders: [READY_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  const { doc } = app;
  doc.querySelector(`[data-action^="pickup"][data-id="${READY_ORDER._id}"]`).click();
  doc.getElementById('pickupCodeInput').value = '99';
  doc.getElementById('confirmPickup').click();
  await new Promise(r => setTimeout(r, 150));
  assert.match(doc.getElementById('pickupMsg').textContent, /4-digit pickup code/);
  assert.equal(putCalls(app.calls, '/status').length, 0, 'no request may be sent for an invalid code');
  });
});

test('reached_restaurant sends the live lat/lng for the backend geofence', { skip: !JSDOM }, async () => {
  await withApp({
    orders: [APPROACH_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {},
    position: { lat: 26.5005, lng: 88.7, accuracy: 8, time: Date.now() },
  }, async app => {
  const { doc } = app;
  doc.querySelector(`[data-action^="status"][data-id="${APPROACH_ORDER._id}"]`).click();
  await new Promise(r => setTimeout(r, 200));
  const call = putCalls(app.calls, `/api/riders/orders/${APPROACH_ORDER._id}/status`)[0];
  assert.ok(call, 'arrival must PUT to the status endpoint');
  const body = JSON.parse(call.body);
  assert.equal(body.status, 'reached_restaurant');
  // The live GPS fix travels with the arrival so the backend can geofence it.
  assert.equal(body.lat, 26.5005);
  assert.equal(body.lng, 88.7);
  });
});

test('a COD delivery sends codCashCollected and a prepaid one does not', { skip: !JSDOM }, async () => {
  await withApp({ orders: [COD_DELIVERY_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  const { doc } = app;
  doc.querySelector(`[data-action^="otp"][data-id="${COD_DELIVERY_ORDER._id}"]`).click();
  // Without the cash confirmation the submit is blocked.
  ['o0', 'o1', 'o2', 'o3'].forEach((id, i) => { doc.getElementById(id).value = String(i + 1); });
  doc.getElementById('verifyOtp').click();
  await new Promise(r => setTimeout(r, 120));
  assert.match(doc.getElementById('otpMsg').textContent, /Tick the box/);
  assert.equal(putCalls(app.calls, '/status').length, 0);
  // With it, the delivery goes through carrying codCashCollected: true.
  doc.getElementById('codConfirm').checked = true;
  doc.getElementById('verifyOtp').click();
  await new Promise(r => setTimeout(r, 250));
  const call = putCalls(app.calls, `/api/riders/orders/${COD_DELIVERY_ORDER._id}/status`)[0];
  assert.ok(call, 'the delivery must PUT to the status endpoint');
  assert.deepEqual(JSON.parse(call.body), { status: 'delivered', codCashCollected: true });
  });
});

test('a prepaid delivery never sends codCashCollected', { skip: !JSDOM }, async () => {
  await withApp({ orders: [PREPAID_DELIVERY_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  const { doc } = app;
  doc.querySelector(`[data-action^="otp"][data-id="${PREPAID_DELIVERY_ORDER._id}"]`).click();
  assert.equal(doc.getElementById('codConfirmWrap').hidden, true);
  ['o0', 'o1', 'o2', 'o3'].forEach((id, i) => { doc.getElementById(id).value = String(i + 1); });
  doc.getElementById('verifyOtp').click();
  await new Promise(r => setTimeout(r, 250));
  const call = putCalls(app.calls, `/api/riders/orders/${PREPAID_DELIVERY_ORDER._id}/status`)[0];
  assert.ok(call, 'the delivery must PUT to the status endpoint');
  assert.deepEqual(JSON.parse(call.body), { status: 'delivered' });
  });
});

test('a 400 geofence rejection is surfaced verbatim in the banner and toast', { skip: !JSDOM }, async () => {
  const app = await boot({
    orders: [APPROACH_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {},
    position: { lat: 26.55, lng: 88.7, accuracy: 8, time: Date.now() },
    rejectStatus: { status: 400, message: 'You are 340m from the restaurant; move within 200m' },
  });
  try {
    const { doc } = app;
    doc.querySelector(`[data-action^="status"][data-id="${APPROACH_ORDER._id}"]`).click();
    await new Promise(r => setTimeout(r, 250));
    // The backend's own distance message is what the rider must see.
    assert.match(doc.getElementById('toast').textContent, /340m from the restaurant/);
    const badge = doc.getElementById('geo-' + APPROACH_ORDER._id);
    assert.ok(badge, 'the geofence badge must exist for the order');
    assert.match(badge.textContent, /340m from the restaurant/);
    assert.ok(badge.classList.contains('outside'));
  } finally { app.close(); }
});

test('an ORDER_READY push triggers the ready chime and alert', { skip: !JSDOM }, async () => {
  await withApp({ orders: [COUNTER_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  assert.deepEqual(app.errors, []);
  const { window, doc } = app;
  window.dispatchEvent(new window.CustomEvent('eatswada:push-received', {
    detail: { data: { type: 'order_ready', orderId: COUNTER_ORDER._id, body: 'Order is packed' } },
  }));
  await new Promise(r => setTimeout(r, 250));
  assert.match(doc.getElementById('toast').textContent, /Order is packed/);
  });
});

/* ---- Backend-aligned upgrade: order ids, payment view, duplicate taps ------- */

const NAMED_ORDER = {
  _id: 'aa'.repeat(12), riderStatus: 'accepted', status: 'assigned',
  orderNumber: 'NB100123', shipmentId: 'SH500001',
  paymentMethod: 'COD', total: 250, riderEarning: 45,
  payment: {
    method: 'cod', isCod: true, isPartialCod: true, orderTotal: 250,
    advanceRequired: 100, advancePaid: 100, advanceStatus: 'paid',
    cashToCollect: 150, cashCollected: false,
    label: '₹100 paid online · collect ₹150 cash', blocksDelivery: false, blockReason: '',
  },
  ...rest(88.7, 26.5), deliveryAddress: { line1: '1 Mall Rd', coordinates: [88.71, 26.51] },
};

test('the dashboard shows the backend orderNumber, not a blank reference', { skip: !JSDOM }, async () => {
  await withApp({ orders: [NAMED_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  assert.deepEqual(app.errors, []);
  const { doc } = app;
  const card = doc.getElementById('order-' + NAMED_ORDER._id);
  assert.ok(card, 'the order card must render');
  assert.match(card.textContent, /NB100123/);
  });
});

test('the COD badge shows the partial-COD balance, never the raw order total', { skip: !JSDOM }, async () => {
  await withApp({ orders: [NAMED_ORDER], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  const { doc } = app;
  const card = doc.getElementById('order-' + NAMED_ORDER._id);
  assert.match(card.textContent, /Collect ₹150/);
  assert.ok(!/Collect ₹250/.test(card.textContent), 'the order total must not be shown as cash to collect');
  });
});

test('an unpaid COD advance disables the deliver button with the backend reason', { skip: !JSDOM }, async () => {
  const blockedOrder = {
    ...NAMED_ORDER, _id: 'bb'.repeat(12), riderStatus: 'out_for_delivery', status: 'out_for_delivery',
    payment: {
      ...NAMED_ORDER.payment, advancePaid: 0, advanceStatus: 'pending',
      blocksDelivery: true, blockReason: 'The customer advance has not been paid; delivery cannot proceed.',
    },
  };
  await withApp({ orders: [blockedOrder], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  const { doc } = app;
  doc.querySelector(`[data-action^="otp"][data-id="${blockedOrder._id}"]`).click();
  await new Promise(r => setTimeout(r, 100));
  assert.equal(doc.getElementById('verifyOtp').disabled, true);
  assert.match(doc.getElementById('otpMsg').textContent, /advance has not been paid/);
  });
});

test('a double tap on accept sends exactly one status request', { skip: !JSDOM }, async () => {
  const order = {
    _id: 'cc'.repeat(12), riderStatus: 'assigned', status: 'assigned', orderNumber: 'NB100999',
    paymentMethod: 'ONLINE', total: 300, riderEarning: 40,
    ...rest(88.7, 26.5), deliveryAddress: { line1: '2 Fort Rd', coordinates: [88.72, 26.52] },
  };
  await withApp({ orders: [order], profile: PROFILE, earnings: EARNINGS, cash: { cashInHand: 0 }, payouts: {} }, async app => {
  const { doc } = app;
  const btn = doc.querySelector(`[data-action^="accept"][data-id="${order._id}"]`);
  assert.ok(btn, 'the accept button must render');
  btn.click();
  btn.click();
  await new Promise(r => setTimeout(r, 250));
  const accepts = app.calls.filter(c => c.method === 'PUT' && c.path.endsWith(`/api/riders/orders/${order._id}/status`) && /"accepted"/.test(String(c.body)));
  assert.equal(accepts.length, 1, 'the second tap must be ignored while the first is in flight');
  });
});
