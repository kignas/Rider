/* Eatswada Rider — shared, dependency-free logic.
 *
 * Pure helpers only (no DOM, no fetch) so the same rules are used by the
 * pages and by the Node test suite. Mirrors the verified backend contract in
 * kignas/Eatswada- (riderApplicationController.js, riderController.js,
 * models/Order.js, services/riderAssignmentService.js). The backend stays
 * authoritative — these checks exist for fast, friendly client feedback.
 *
 * Loads as a browser global (window.RiderLogic) and as a CommonJS module.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RiderLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // RiderApplication.vehicleType enum (models/RiderApplication.js).
  const VEHICLE_TYPES = ['bike', 'scooter', 'bicycle', 'car'];
  // RiderApplication.status enum (models/RiderApplication.js).
  const APPLICATION_STATUSES = ['submitted', 'under_review', 'needs_changes', 'approved', 'rejected', 'withdrawn'];
  // Rider-owned statuses the dashboard treats as active (riderController.js).
  const ACTIVE_RIDER_STATUSES = ['assigned', 'accepted', 'reached_restaurant', 'picked_up', 'out_for_delivery'];
  // Order.status values the backend accepts before a rider may mark picked_up.
  const PICKUP_ALLOWED_ORDER_STATUSES = ['waiting_for_rider', 'assigned'];

  const PHONE_REGEX = /^\+?[1-9]\d{9,14}$/;
  const EMAIL_REGEX = /^\S+@\S+\.\S+$/;
  const OTP_REGEX = /^\d{4}$/;

  // A stored application reference older than this is treated as stale and the
  // applicant is asked to re-enter the reference rather than silently failing.
  const MAX_APPLICATION_REF_AGE_MS = 90 * 24 * 60 * 60 * 1000;

  // Matches the backend normalizer: strip spaces and ()- only.
  function normalizePhone(value) {
    return String(value == null ? '' : value).replace(/[\s()-]/g, '').trim();
  }

  function normalizeVehicleType(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function normalizeEmail(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function normalizePlate(value) {
    return String(value == null ? '' : value).trim().toUpperCase();
  }

  /* Client validation for the application form. Returns
   * { valid, errors: {field: message}, message } where message is the first
   * error (used for the top banner). */
  function validateApplication(form) {
    const f = form || {};
    const errors = {};

    const name = String(f.name || '').trim();
    if (name.length < 2 || name.length > 60) errors.name = 'Enter your full name (2–60 characters).';

    const phone = normalizePhone(f.phone);
    if (!PHONE_REGEX.test(phone)) errors.phone = 'Enter a valid phone number with country code if needed.';

    const email = normalizeEmail(f.email);
    if (email && !EMAIL_REGEX.test(email)) errors.email = 'Enter a valid email address.';

    const password = String(f.password || '');
    if (password.length < 8 || password.length > 72) errors.password = 'Password must be 8–72 characters.';

    const vehicleType = normalizeVehicleType(f.vehicleType);
    if (!VEHICLE_TYPES.includes(vehicleType)) errors.vehicleType = 'Select a valid vehicle type.';

    const deliveryZone = String(f.deliveryZone || '').trim();
    if (!deliveryZone || deliveryZone.length > 80) errors.deliveryZone = 'Enter your delivery area.';

    const vehicleNumber = normalizePlate(f.vehicleNumber);
    const drivingLicenseNumber = normalizePlate(f.drivingLicenseNumber);
    if (vehicleNumber.length > 20 || drivingLicenseNumber.length > 40) {
      errors.vehicleNumber = 'One or more vehicle/license fields are too long.';
    }

    const first = Object.keys(errors)[0];
    return { valid: first === undefined, errors, message: first ? errors[first] : '' };
  }

  /* Build the exact POST /api/rider-applications body. Never logs or stores
   * the password; the caller must discard the returned object after use. */
  function buildApplicationPayload(form) {
    const f = form || {};
    const vehicleNumber = normalizePlate(f.vehicleNumber);
    return {
      name: String(f.name || '').trim(),
      phone: normalizePhone(f.phone),
      email: normalizeEmail(f.email),
      password: String(f.password || ''),
      vehicleType: normalizeVehicleType(f.vehicleType),
      vehicleNumber,
      deliveryZone: String(f.deliveryZone || '').trim(),
      drivingLicenseNumber: normalizePlate(f.drivingLicenseNumber),
      vehicleRegistrationNumber: normalizePlate(f.vehicleRegistrationNumber) || vehicleNumber,
    };
  }

  /* The applicant's stored reference: only the minimum needed for a status
   * lookup (the id the backend returns plus the phone used to apply). */
  function buildApplicationRef(form, submitData, now) {
    const f = form || {};
    const data = submitData || {};
    return {
      id: data.id ? String(data.id) : '',
      phone: normalizePhone(f.phone),
      name: String(data.name || f.name || '').trim(),
      status: String(data.status || 'submitted'),
      savedAt: new Date(now == null ? Date.now() : now).toISOString(),
    };
  }

  function validateApplicationRef(ref) {
    const r = ref || {};
    const id = String(r.id || '').trim();
    const phone = normalizePhone(r.phone);
    if (!/^[a-f0-9]{24}$/i.test(id)) {
      return { valid: false, message: 'Enter the application ID from your submission confirmation.' };
    }
    if (!PHONE_REGEX.test(phone)) {
      return { valid: false, message: 'Enter the phone number you used to apply.' };
    }
    return { valid: true, id, phone };
  }

  function isApplicationRefStale(ref, now, maxAgeMs) {
    const saved = ref && ref.savedAt ? Date.parse(ref.savedAt) : NaN;
    if (!Number.isFinite(saved)) return true;
    const max = maxAgeMs == null ? MAX_APPLICATION_REF_AGE_MS : maxAgeMs;
    const at = now == null ? Date.now() : now;
    return at - saved > max;
  }

  /* Presentation for each application status the backend can return. */
  function statusMeta(status) {
    const s = String(status || '').trim().toLowerCase();
    switch (s) {
      case 'submitted':
        return { label: 'Submitted', tone: 'info', description: 'Your application has been received and is waiting for an Eatswada admin to review it.' };
      case 'under_review':
        return { label: 'Under review', tone: 'info', description: 'An Eatswada admin is currently reviewing your application.' };
      case 'needs_changes':
        return { label: 'Needs changes', tone: 'warn', description: 'The admin needs more information before this application can be approved.' };
      case 'approved':
        return { label: 'Approved', tone: 'ok', description: 'Your application was approved. Log in with the phone number and password you used when applying.' };
      case 'rejected':
        return { label: 'Not approved', tone: 'bad', description: 'This application was not approved by the Eatswada admin team.' };
      case 'withdrawn':
        return { label: 'Withdrawn', tone: 'bad', description: 'This application was withdrawn and is no longer under review.' };
      default:
        return { label: status ? String(status) : 'Unknown', tone: 'info', description: 'The server returned a status this app does not recognise.' };
    }
  }

  function kitchenStatusLabel(status) {
    const s = String(status || '').trim().toLowerCase();
    const map = {
      placed: 'Order placed',
      confirmed: 'Restaurant confirmed',
      preparing: 'Kitchen preparing',
      waiting_for_rider: 'Food ready for pickup',
      assigned: 'Food ready for pickup',
      out_for_delivery: 'Out for delivery',
      otp_verified: 'PIN verified',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    };
    return map[s] || (s ? s : 'Unknown');
  }

  /* The rule the dashboard needs before allowing "Picked up". The backend only
   * accepts picked_up when the order has been released by the kitchen, i.e.
   * order.status is waiting_for_rider, assigned or otp_verified. The gate is
   * only relevant while the rider is at the restaurant waiting to collect: once
   * the order is picked_up the rider is past the restaurant and must be able to
   * continue to delivery. */
  function pickupGate(order) {
    const o = order || {};
    const riderStatus = String(o.riderStatus || '');
    const orderStatus = String(o.status || '');
    if (riderStatus !== 'reached_restaurant') {
      return { relevant: false, allowed: true, reason: '' };
    }
    if (orderStatus === 'cancelled') {
      return { relevant: true, allowed: false, reason: 'This order has been cancelled.' };
    }
    if (PICKUP_ALLOWED_ORDER_STATUSES.includes(orderStatus)) {
      return { relevant: true, allowed: true, reason: '' };
    }
    return {
      relevant: true,
      allowed: false,
      reason: 'The restaurant has not marked this order ready yet. You can wait at the restaurant, but pickup is not available.',
    };
  }

  function isActiveOrder(order) {
    return ACTIVE_RIDER_STATUSES.includes(String((order || {}).riderStatus || ''));
  }

  function activeOrders(orders) {
    return (Array.isArray(orders) ? orders : []).filter(isActiveOrder);
  }

  function isValidOtp(value) {
    return OTP_REGEX.test(String(value == null ? '' : value).trim());
  }

  function validateCoordinates(lat, lng) {
    if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '') {
      return { valid: false, message: 'Location is not available yet.' };
    }
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return { valid: false, message: 'Location is not available yet.' };
    if (la < -90 || la > 90 || ln < -180 || ln > 180) return { valid: false, message: 'The device reported an invalid location.' };
    return { valid: true };
  }

  /* Location freshness rule: the backend only dispatches to riders whose GPS
   * fix is newer than RIDER_LOCATION_MAX_AGE_MS (default 3 minutes). */
  function isFreshLocation(updatedAt, now, maxAgeMs) {
    const t = Date.parse(updatedAt);
    if (!Number.isFinite(t)) return false;
    const max = maxAgeMs == null ? 3 * 60 * 1000 : maxAgeMs;
    return (now == null ? Date.now() : now) - t <= max;
  }

  /* ---- Earnings truthfulness ------------------------------------------------
   * Rider earnings may only come from a field the backend uses for rider pay.
   * A generic order total (or the COD amount the customer hands over) is money
   * the customer paid, never the rider's pay, so it is deliberately excluded
   * from every rider-earning calculation.
   */
  const RIDER_EARNING_FIELDS = ['riderEarning', 'riderEarnings', 'riderPay', 'riderPayout', 'riderFee', 'deliveryEarning'];
  const ORDER_TOTAL_FIELDS = ['total', 'orderTotal', 'grandTotal', 'amount'];
  const CUSTOMER_TIP_FIELDS = ['tipAmount', 'customerTip', 'tip', 'deliveryTip'];
  const ORDER_BONUS_FIELDS = ['eatswadaBonus', 'riderBonus', 'deliveryBonus', 'bonus', 'platformBonus'];

  function firstNumber(source, fields) {
    const s = source || {};
    for (const field of fields) {
      const raw = s[field];
      if (raw === null || raw === undefined || raw === '') continue;
      const value = Number(raw);
      if (Number.isFinite(value)) return { value, field };
    }
    return null;
  }

  function pickRiderEarning(order) { return firstNumber(order, RIDER_EARNING_FIELDS); }
  function pickOrderTotal(order) { return firstNumber(order, ORDER_TOTAL_FIELDS); }
  function pickOrderBonus(order) { return firstNumber(order, ORDER_BONUS_FIELDS); }
  function pickCustomerTip(order) {
    const hit = firstNumber(order, CUSTOMER_TIP_FIELDS);
    if (hit) return hit;
    const paise = Number((order || {}).tipAmountPaise);
    return Number.isFinite(paise) ? { value: paise / 100, field: 'tipAmountPaise' } : null;
  }

  /* The documented Eatswada offer policy. Used only when the order does not
   * carry real amounts, and the caller must label those lines as estimates. */
  const OFFER_POLICY = { deliveryFee: 25, bonus: 10 };

  function offerEarnings(order, policy) {
    const p = Object.assign({}, OFFER_POLICY, policy || {});
    const o = order || {};
    const lines = [];
    let estimate = false;

    const riderEarning = pickRiderEarning(o);
    if (riderEarning) lines.push({ label: 'Delivery earning', value: riderEarning.value, source: 'backend' });
    else { lines.push({ label: 'Delivery earning', value: p.deliveryFee, source: 'policy' }); estimate = true; }

    const bonus = pickOrderBonus(o);
    if (bonus) lines.push({ label: 'Eatswada bonus', value: bonus.value, source: 'backend' });
    else { lines.push({ label: 'Eatswada bonus', value: p.bonus, source: 'policy' }); estimate = true; }

    const tip = pickCustomerTip(o);
    if (tip && tip.value > 0) lines.push({ label: 'Customer tip', value: tip.value, source: 'backend' });
    else lines.push({ label: 'Customer tip', value: 0, source: tip ? 'backend' : 'policy' });

    return { lines, sum: lines.reduce((sum, line) => sum + line.value, 0), estimate };
  }

  /* Weekly incentive ladder: cumulative ₹50 at 10 deliveries, ₹100 at 20 and
   * ₹150 at 30, per Monday–Sunday IST week. */
  function weeklyIncentive(deliveries) {
    const n = Math.max(0, Math.floor(Number(deliveries) || 0));
    const milestone = n >= 30 ? 30 : n >= 20 ? 20 : n >= 10 ? 10 : 0;
    const amount = milestone === 30 ? 150 : milestone === 20 ? 100 : milestone === 10 ? 50 : 0;
    const next = n < 10 ? 10 : n < 20 ? 20 : n < 30 ? 30 : null;
    return {
      deliveries: n,
      milestone,
      amount,
      next,
      remaining: next === null ? 0 : next - n,
      progress: Math.min(100, (n / 30) * 100),
    };
  }

  /* Completed-delivery count from an earnings block, tolerating the field names
   * the backend has used. Returns null when the block carries no count. */
  function earningsOrderCount(block) {
    const hit = firstNumber(block, ['deliveries', 'orders', 'count', 'totalDeliveries']);
    return hit ? hit.value : null;
  }


  /* ---- Duplicate-submission guard -------------------------------------------
   * One in-flight request per key (an order id). The dashboard renders the same
   * action button in the focus card and in the order list, so a per-button
   * "disabled" flag is not enough: a second tap on the twin button, or a tap
   * after a poll re-render, would send a second status PUT. */
  function createInFlightGuard() {
    const active = new Set();
    return {
      isBusy(key) { return active.has(String(key)); },
      async run(key, fn) {
        const k = String(key);
        if (active.has(k)) return { skipped: true };
        active.add(k);
        try { return { skipped: false, value: await fn() }; }
        finally { active.delete(k); }
      },
    };
  }

  /* Delivery completion is two calls (verify-otp, then status=delivered). If the
   * first succeeded and the second failed, the retry must not re-submit the PIN:
   * the backend has already consumed it (order.status becomes otp_verified). */
  function nextDeliveryStep(orderId, verifiedIds, orderStatus) {
    const done = verifiedIds && typeof verifiedIds.has === 'function' && verifiedIds.has(String(orderId));
    return done || String(orderStatus || '') === 'otp_verified' ? 'deliver-only' : 'verify-and-deliver';
  }

  /* Warnings for the home screen. Pure: every input is a fact the page has
   * actually observed (server-confirmed online flag, last GPS fix, permission
   * state). Nothing here is inferred from missing data except "no fix yet". */
  function homeAlerts(state) {
    const s = state || {};
    const out = [];
    if (s.online && !s.hasLocation) {
      out.push({
        id: 'location-off', tone: 'warn', title: 'Location is off',
        body: 'Eatswada needs your location to match you with nearby orders.',
        action: { id: 'enable-location', label: 'Turn on location' },
      });
    } else if (s.online && s.hasLocation && s.locationAt != null &&
               !isFreshLocation(new Date(s.locationAt).toISOString(), s.now, s.maxAgeMs)) {
      out.push({
        id: 'location-stale', tone: 'warn', title: 'Location is out of date',
        body: 'Your last GPS fix is old. Move to an open area or check that location services are on.',
      });
    }
    if (s.online && s.native && s.hasLocation && s.backgroundTracking === 'off') {
      out.push({
        id: 'location-foreground-only', tone: 'info', title: 'Location updates only while the app is open',
        body: 'Keep Eatswada on screen, or allow background location when asked, so dispatch keeps seeing you.',
      });
    }
    if (s.notificationState === 'denied') {
      out.push({
        id: 'notifications-blocked', tone: 'warn', title: 'Delivery alerts are blocked',
        body: 'You may miss new orders while the app is closed. Turn notifications on in Android Settings → Apps → Eatswada Delivery Partner.',
      });
    }
    return out;
  }

  /* Weekly-incentive wording. The ladder is a documented policy, but the
   * earnings API returns a rolling 7-day block unless it also supplies the
   * week window; in that case no amount is presented as "unlocked". */
  function incentiveDisplay(incentive, exact, formatMoney) {
    const w = incentive || weeklyIncentive(0);
    const fmt = typeof formatMoney === 'function' ? formatMoney : (n => '₹' + n);
    if (!exact) {
      return { amountText: '—', earnedText: 'Progress is approximate', approximate: true };
    }
    return { amountText: fmt(w.amount), earnedText: w.amount > 0 ? fmt(w.amount) + ' reached — confirmed by Eatswada' : 'Not reached yet', approximate: false };
  }

  return {
    VEHICLE_TYPES,
    APPLICATION_STATUSES,
    ACTIVE_RIDER_STATUSES,
    PICKUP_ALLOWED_ORDER_STATUSES,
    PHONE_REGEX,
    EMAIL_REGEX,
    OTP_REGEX,
    MAX_APPLICATION_REF_AGE_MS,
    RIDER_EARNING_FIELDS,
    ORDER_TOTAL_FIELDS,
    OFFER_POLICY,
    normalizePhone,
    normalizeVehicleType,
    normalizeEmail,
    normalizePlate,
    validateApplication,
    buildApplicationPayload,
    buildApplicationRef,
    validateApplicationRef,
    isApplicationRefStale,
    statusMeta,
    kitchenStatusLabel,
    pickupGate,
    isActiveOrder,
    activeOrders,
    isValidOtp,
    validateCoordinates,
    isFreshLocation,
    firstNumber,
    pickRiderEarning,
    pickOrderTotal,
    pickOrderBonus,
    pickCustomerTip,
    offerEarnings,
    weeklyIncentive,
    earningsOrderCount,
    createInFlightGuard,
    nextDeliveryStep,
    homeAlerts,
    incentiveDisplay,
  };
});
