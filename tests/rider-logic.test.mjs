import { test } from 'node:test';
import assert from 'node:assert/strict';
import L from '../rider-logic.js';

test('normalizePhone strips spaces, dashes and parentheses like the backend', () => {
  assert.equal(L.normalizePhone(' 98765 43210 '), '9876543210');
  assert.equal(L.normalizePhone('(98765)-43210'), '9876543210');
  assert.equal(L.normalizePhone('+91 98765 43210'), '+919876543210');
  assert.equal(L.normalizePhone(null), '');
});

test('validateApplication accepts a minimal valid application', () => {
  const r = L.validateApplication({
    name: 'Asha Roy',
    phone: '9876543210',
    email: '',
    password: 'supersecret',
    vehicleType: 'bike',
    deliveryZone: 'Maynaguri',
  });
  assert.equal(r.valid, true);
  assert.equal(r.message, '');
});

test('validateApplication rejects each backend rule', () => {
  const base = {
    name: 'Asha Roy', phone: '9876543210', email: '', password: 'supersecret',
    vehicleType: 'bike', deliveryZone: 'Maynaguri',
  };
  assert.match(L.validateApplication({ ...base, name: 'A' }).errors.name, /2–60/);
  assert.match(L.validateApplication({ ...base, name: 'x'.repeat(61) }).errors.name, /2–60/);
  assert.ok(L.validateApplication({ ...base, phone: '12345' }).errors.phone);
  assert.match(L.validateApplication({ ...base, email: 'not-an-email' }).errors.email, /valid email/);
  assert.match(L.validateApplication({ ...base, password: 'short' }).errors.password, /8–72/);
  assert.match(L.validateApplication({ ...base, password: 'x'.repeat(73) }).errors.password, /8–72/);
  assert.match(L.validateApplication({ ...base, vehicleType: 'cycle' }).errors.vehicleType, /vehicle type/);
  assert.match(L.validateApplication({ ...base, deliveryZone: '' }).errors.deliveryZone, /delivery area/);
  assert.match(L.validateApplication({ ...base, vehicleNumber: 'x'.repeat(21) }).errors.vehicleNumber, /too long/);
});

test('vehicle types match the backend enum exactly', () => {
  assert.deepEqual(L.VEHICLE_TYPES, ['bike', 'scooter', 'bicycle', 'car']);
});

test('buildApplicationPayload matches the controller field names', () => {
  const p = L.buildApplicationPayload({
    name: ' Asha Roy ', phone: '+91 98765-43210', email: 'ASHA@Example.COM ',
    password: 'supersecret', vehicleType: 'BIKE', vehicleNumber: 'wb64ab1234',
    deliveryZone: ' Maynaguri ', drivingLicenseNumber: 'dl-99',
  });
  assert.deepEqual(Object.keys(p).sort(), [
    'deliveryZone', 'drivingLicenseNumber', 'email', 'name', 'password',
    'phone', 'vehicleNumber', 'vehicleRegistrationNumber', 'vehicleType',
  ]);
  assert.equal(p.name, 'Asha Roy');
  assert.equal(p.phone, '+919876543210');
  assert.equal(p.email, 'asha@example.com');
  assert.equal(p.vehicleType, 'bike');
  assert.equal(p.vehicleNumber, 'WB64AB1234');
  assert.equal(p.drivingLicenseNumber, 'DL-99');
  // vehicleRegistrationNumber falls back to the vehicle number when omitted.
  assert.equal(p.vehicleRegistrationNumber, 'WB64AB1234');
});

test('buildApplicationRef keeps only the minimum reference fields', () => {
  const ref = L.buildApplicationRef(
    { phone: '98765 43210', name: 'Asha Roy', password: 'supersecret' },
    { id: 'abc123', status: 'submitted', name: 'Asha Roy' },
    1700000000000
  );
  assert.deepEqual(Object.keys(ref).sort(), ['id', 'name', 'phone', 'savedAt', 'status']);
  assert.equal(ref.phone, '9876543210');
  assert.equal(ref.id, 'abc123');
  assert.equal(JSON.stringify(ref).includes('supersecret'), false);
});

test('validateApplicationRef requires a 24-hex id and a valid phone', () => {
  assert.equal(L.validateApplicationRef({ id: 'a'.repeat(24), phone: '9876543210' }).valid, true);
  assert.equal(L.validateApplicationRef({ id: 'short', phone: '9876543210' }).valid, false);
  assert.equal(L.validateApplicationRef({ id: 'a'.repeat(24), phone: '123' }).valid, false);
});

test('isApplicationRefStale treats old or malformed references as stale', () => {
  const now = Date.parse('2026-01-31T00:00:00Z');
  const fresh = { savedAt: '2026-01-30T00:00:00Z' };
  const old = { savedAt: '2025-01-01T00:00:00Z' };
  assert.equal(L.isApplicationRefStale(fresh, now), false);
  assert.equal(L.isApplicationRefStale(old, now), true);
  assert.equal(L.isApplicationRefStale({}, now), true);
});

test('statusMeta covers every backend application status', () => {
  for (const s of L.APPLICATION_STATUSES) {
    const meta = L.statusMeta(s);
    assert.ok(meta.label && meta.tone && meta.description, `missing meta for ${s}`);
  }
  assert.equal(L.statusMeta('approved').tone, 'ok');
  assert.equal(L.statusMeta('rejected').tone, 'bad');
  assert.equal(L.statusMeta('needs_changes').tone, 'warn');
});

test('kitchenStatusLabel separates kitchen state from rider state', () => {
  assert.equal(L.kitchenStatusLabel('preparing'), 'Kitchen preparing');
  assert.equal(L.kitchenStatusLabel('waiting_for_rider'), 'Food ready for pickup');
  assert.equal(L.kitchenStatusLabel('assigned'), 'Food ready for pickup');
});

test('pickupGate blocks pickup until the kitchen has released the order', () => {
  assert.equal(L.pickupGate({ riderStatus: 'reached_restaurant', status: 'preparing' }).allowed, false);
  assert.equal(L.pickupGate({ riderStatus: 'reached_restaurant', status: 'confirmed' }).allowed, false);
  assert.equal(L.pickupGate({ riderStatus: 'reached_restaurant', status: 'waiting_for_rider' }).allowed, true);
  assert.equal(L.pickupGate({ riderStatus: 'reached_restaurant', status: 'assigned' }).allowed, true);
  assert.equal(L.pickupGate({ riderStatus: 'accepted', status: 'preparing' }).relevant, false);
  assert.match(L.pickupGate({ riderStatus: 'reached_restaurant', status: 'preparing' }).reason, /not marked this order ready/);
});

test('pickupGate blocks pickup on a cancelled order', () => {
  const g = L.pickupGate({ riderStatus: 'reached_restaurant', status: 'cancelled' });
  assert.equal(g.allowed, false);
  assert.match(g.reason, /cancelled/);
});

test('stale assignment handling: an order no longer assigned is not active', () => {
  assert.equal(L.isActiveOrder({ riderStatus: 'assigned' }), true);
  assert.equal(L.isActiveOrder({ riderStatus: 'unassigned' }), false);
  assert.equal(L.isActiveOrder({ riderStatus: 'delivered' }), false);
  assert.equal(L.isActiveOrder({}), false);
  const list = [{ riderStatus: 'assigned' }, { riderStatus: 'unassigned' }, { riderStatus: 'picked_up' }];
  assert.equal(L.activeOrders(list).length, 2);
});

test('isValidOtp requires exactly four digits', () => {
  assert.equal(L.isValidOtp('1234'), true);
  assert.equal(L.isValidOtp(' 1234 '), true);
  assert.equal(L.isValidOtp('123'), false);
  assert.equal(L.isValidOtp('12a4'), false);
});

test('validateCoordinates rejects missing or out-of-range fixes', () => {
  assert.equal(L.validateCoordinates(26.5, 89.2).valid, true);
  assert.equal(L.validateCoordinates(NaN, 89.2).valid, false);
  assert.equal(L.validateCoordinates(91, 89.2).valid, false);
  assert.equal(L.validateCoordinates(26.5, 181).valid, false);
  assert.equal(L.validateCoordinates(null, null).valid, false);
});

test('isFreshLocation honours the backend location freshness window', () => {
  const now = Date.parse('2026-01-31T00:05:00Z');
  assert.equal(L.isFreshLocation('2026-01-31T00:04:00Z', now), true); // 1 min old
  assert.equal(L.isFreshLocation('2026-01-31T00:00:00Z', now), false); // 5 min old
  assert.equal(L.isFreshLocation('not-a-date', now), false);
});
