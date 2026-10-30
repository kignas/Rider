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

  /* The backend already computes the weekly incentive (₹50 per completed block
   * of 10 deliveries in the current Asia/Kolkata week) and returns it as
   * `weeklyIncentive` and `thisWeek.incentive`. When it does, that number is
   * authoritative and is shown as-is. Only when the backend does not send it do
   * we fall back to the documented ladder — and then it is labelled approximate
   * by the caller. Returns { amount, source, deliveries }. */
  function backendWeeklyIncentive(earnings) {
    const e = earnings || {};
    const top = firstNumber(e, ['weeklyIncentive']);
    if (top) return { amount: top.value, source: 'backend', deliveries: earningsOrderCount(e.thisWeek) };
    const week = e.thisWeek || {};
    const inner = firstNumber(week, ['incentive', 'weeklyIncentive', 'incentiveEarnings']);
    if (inner) return { amount: inner.value, source: 'backend', deliveries: earningsOrderCount(week) };
    return { amount: null, source: 'derived', deliveries: earningsOrderCount(week) };
  }


  /* ---- Money formatting -----------------------------------------------------
   * One shared formatter so every ₹ figure the rider sees is written the same
   * way (Indian digit grouping, no invented precision). */
  function rupees(value, decimals) {
    const v = Number(value);
    const safe = Number.isFinite(v) ? v : 0;
    const d = Math.max(0, Math.min(2, Math.floor(Number(decimals) || 0)));
    return '₹' + safe.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }


  /* Same shape as the dashboard's money(): Indian grouping, no forced trailing
   * zeros, so every ₹ figure the rider sees is written identically. */
  function moneyText(value) {
    const v = Number(value);
    const safe = Number.isFinite(v) ? v : 0;
    return '₹' + safe.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  /* ---- Surge, rejection cooldown and the COD cash ceiling -------------------
   * These are dispatch policies the backend owns. The app only presents the
   * values it was actually given and never invents a bonus or a limit. */
  const REJECTION_LIMIT = 3;
  const REJECTION_COOLDOWN_MINUTES = 15;
  const COD_CASH_LIMIT_DEFAULT = 2000;
  const RAIN_SURGE_BONUS_FIELDS = ['rainSurgeBonus', 'surgeBonus', 'peakSurgeBonus', 'rainSurgeAmount', 'surgeAmount', 'rainBonus'];

  /* A surge is active only when a payload explicitly says so. The bonus amount
   * is shown only when the backend supplied one. */
  function rainSurgeInfo(profile, order) {
    const p = profile || {};
    const details = p.riderDetails || {};
    const o = order || {};
    const active = [p, details, o].some(
      s => s && (s.isRainSurgeActive === true || s.rainSurgeActive === true)
    );
    if (!active) return { active: false, bonus: null, text: '' };
    const hit = firstNumber(o, RAIN_SURGE_BONUS_FIELDS) || firstNumber(details, RAIN_SURGE_BONUS_FIELDS) || firstNumber(p, RAIN_SURGE_BONUS_FIELDS);
    const bonus = hit ? hit.value : null;
    return {
      active: true,
      bonus,
      text: bonus == null
        ? '🌧️ Rain Surge Active: surge bonus applies per delivery'
        : '🌧️ Rain Surge Active: +' + rupees(bonus) + ' bonus per delivery',
    };
  }

  /* Consecutive-rejection warning. Visible only when the rider has actually
   * rejected an order, so a fresh rider never sees a scare banner. */
  function rejectionWarning(riderDetails) {
    const d = riderDetails || {};
    const count = Math.max(0, Math.floor(Number(d.consecutiveRejections) || 0));
    const limit = Math.max(1, Math.floor(Number(d.rejectionLimit) || REJECTION_LIMIT));
    if (!count) return { visible: false, count: 0, limit, remaining: limit, cooldownMinutes: REJECTION_COOLDOWN_MINUTES, message: '' };
    const remaining = Math.max(0, limit - count);
    const minutes = Math.max(1, Math.floor(Number(d.rejectionCooldownMinutes) || REJECTION_COOLDOWN_MINUTES));
    return {
      visible: true,
      count,
      limit,
      remaining,
      cooldownMinutes: minutes,
      message: remaining > 0
        ? 'Rejections: ' + count + '/' + limit + ' — Next rejection triggers ' + minutes + 'm cooldown'
        : 'Rejections: ' + count + '/' + limit + ' — Limit reached; the next rejection applies a ' + minutes + 'm cooldown',
    };
  }

  /* Live MM:SS countdown for an active rejection cooldown. */
  function cooldownRemaining(cooldownUntil, now) {
    const at = Date.parse(cooldownUntil);
    if (!Number.isFinite(at)) return { active: false, ms: 0, seconds: 0, text: '' };
    const t = now == null ? Date.now() : now;
    const ms = at - t;
    if (ms <= 0) return { active: false, ms: 0, seconds: 0, text: '' };
    const total = Math.ceil(ms / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return { active: true, ms, seconds: total, text: '⏸️ Cooldown Active: ' + mm + ':' + ss + ' remaining' };
  }

  function rejectionTracker(riderDetails, now) {
    const d = riderDetails || {};
    return { warning: rejectionWarning(d), cooldown: cooldownRemaining(d.cooldownUntil, now) };
  }

  /* COD cash-in-hand against the rider's ceiling. The ceiling falls back to the
   * documented ₹2,000 policy only when the backend did not send one. */
  function codCashStatus(cashInHand, codCashLimit) {
    const cash = Math.max(0, Number(cashInHand) || 0);
    const raw = Number(codCashLimit);
    const limit = Number.isFinite(raw) && raw > 0 ? raw : COD_CASH_LIMIT_DEFAULT;
    const reached = cash >= limit;
    return {
      cash,
      limit,
      reached,
      pct: Math.min(100, Math.round((cash / limit) * 100)),
      label: 'COD Cash in Hand: ' + rupees(cash) + ' / ' + rupees(limit),
      warning: reached
        ? '⚠️ COD Cash Limit Reached — Deposit cash with Admin to unlock new COD orders (Prepaid UPI orders still active).'
        : '',
    };
  }


  /* ---- Pickup geofence ------------------------------------------------------
   * Straight-line metres between the rider's live fix and the restaurant. The
   * 200 m zone is the pickup zone; the backend remains the authority on whether
   * a reached_restaurant call is accepted. */
  const GEOFENCE_RADIUS_M = 200;

  /* Number(null) and Number('') are both 0, so a plain Number() check would turn
   * a missing coordinate into the valid-looking point 0,0 (Null Island). Reject
   * absent values explicitly before converting. */
  function finiteCoord(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function coordinatesOf(source) {
    const s = source || {};
    const raw = s.coordinates || (s.location && s.location.coordinates);
    if (Array.isArray(raw) && raw.length >= 2) {
      const lng = finiteCoord(raw[0]);
      const lat = finiteCoord(raw[1]);
      if (lat !== null && lng !== null) return { lat, lng };
    }
    const flat = (latKey, lngKey) => {
      const lat = finiteCoord(s[latKey]);
      const lng = finiteCoord(s[lngKey]);
      return lat !== null && lng !== null ? { lat, lng } : null;
    };
    return flat('latitude', 'longitude') || flat('lat', 'lng');
  }

  function restaurantCoordinates(order) {
    const o = order || {};
    const r = o.restaurant && typeof o.restaurant === 'object' ? o.restaurant : {};
    return coordinatesOf(r.location || r.coordinates)
      || coordinatesOf(o.restaurantLocation)
      || coordinatesOf(o.pickupLocation);
  }

  function haversineMeters(lat1, lng1, lat2, lng2) {
    const nums = [lat1, lng1, lat2, lng2].map(Number);
    if (nums.some(n => !Number.isFinite(n))) return null;
    const [a, b, c, d] = nums;
    const R = 6371000, p = Math.PI / 180;
    const x = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  function geofenceStatus(distanceM, radiusM) {
    const rawRadius = Number(radiusM);
    const radius = Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : GEOFENCE_RADIUS_M;
    /* Number(null) and Number('') are both 0, which would read as "0 m away,
       inside the zone". A missing fix must stay unknown, so reject it first. */
    const missing = distanceM === null || distanceM === undefined || distanceM === '';
    const d = missing ? NaN : Number(distanceM);
    if (!Number.isFinite(d) || d < 0) {
      return { known: false, inside: false, distance: null, radius, text: '📍 Distance to restaurant unavailable' };
    }
    const m = Math.round(d);
    const inside = m <= radius;
    return {
      known: true,
      inside,
      distance: m,
      radius,
      text: inside
        ? '📍 ' + m + 'm from restaurant — Inside Pickup Zone'
        : '📍 ' + m + 'm away — Move within ' + radius + 'm',
    };
  }

  function pickupGeofence(order, position) {
    const from = restaurantCoordinates(order);
    const to = coordinatesOf(position);
    if (!from || !to) return geofenceStatus(null);
    return geofenceStatus(haversineMeters(to.lat, to.lng, from.lat, from.lng));
  }


  /* ---- Restaurant wait time, kitchen readiness and handover ----------------- */
  const WAIT_COMPENSATION_MINUTES = 7;
  const KITCHEN_RELEASED_STATUSES = ['waiting_for_rider', 'assigned', 'otp_verified'];

  function waitTimeInfo(order, now) {
    const o = order || {};
    const startedAt = Date.parse(o.reachedRestaurantAt || o.reachedAt || o.riderReachedAt);
    if (!Number.isFinite(startedAt)) {
      return { active: false, ms: null, minutes: 0, seconds: 0, thresholdMinutes: WAIT_COMPENSATION_MINUTES, compensationApplies: false, text: '', note: '' };
    }
    const t = now == null ? Date.now() : now;
    const ms = Math.max(0, t - startedAt);
    const total = Math.floor(ms / 1000);
    const minutes = Math.floor(total / 60);
    const mm = String(minutes).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const threshold = Math.max(1, Math.floor(Number(o.waitCompensationMinutes) || WAIT_COMPENSATION_MINUTES));
    const compensationApplies = minutes >= threshold;
    return {
      active: true,
      ms,
      minutes,
      seconds: total,
      thresholdMinutes: threshold,
      compensationApplies,
      text: '⏱️ Waiting at restaurant: ' + mm + ':' + ss,
      note: compensationApplies
        ? 'Wait-time compensation applies after ' + threshold + ' minutes (' + minutes + ' min waited).'
        : 'Wait-time compensation applies after ' + threshold + ' minutes.',
    };
  }

  /* Kitchen prep handshake. "Ready" comes from isFoodReady or a kitchen status
   * that means the order has been released to the rider. The estimate is only
   * shown when the backend supplied an expected-ready timestamp. */
  function kitchenReadyInfo(order, now) {
    const o = order || {};
    const released = KITCHEN_RELEASED_STATUSES.includes(String(o.status || ''));
    if (o.isFoodReady === true || released) {
      return { ready: true, etaText: '', remainingMs: 0, text: '🛍️ ORDER IS PACKED & READY AT COUNTER!' };
    }
    const t = now == null ? Date.now() : now;
    const eta = Date.parse(o.estimatedReadyAt || o.expectedReadyAt || o.readyAt);
    if (Number.isFinite(eta)) {
      const ms = Math.max(0, eta - t);
      const total = Math.floor(ms / 1000);
      const mm = String(Math.floor(total / 60)).padStart(2, '0');
      const ss = String(total % 60).padStart(2, '0');
      return { ready: false, etaText: mm + ':' + ss, remainingMs: ms, text: '🍳 Kitchen is preparing order (Est. ready: ' + mm + ':' + ss + ')' };
    }
    return { ready: false, etaText: '', remainingMs: null, text: '🍳 Kitchen is preparing order' };
  }

  /* What the rider must check at the counter: the 4-digit pickup code the
   * restaurant shows, any cutlery request and whether the code was already
   * verified. The backend stores pickupCodeHash as select:false, so the code is
   * never returned to the app — the rider types what the restaurant shows and
   * POST /api/riders/orders/:id/verify-pickup-code checks it server-side. */
  function pickupHandover(order) {
    const o = order || {};
    const code = String(o.pickupCode || o.pickupOtp || o.pickupPin || o.handoverCode || '').trim();
    const cutlery = o.sendCutlery === true || o.cutlery === true || o.isCutleryRequested === true;
    return {
      code,
      display: code ? '#' + code : '',
      requiresCode: !!code || o.pickupCodeRequired === true,
      codeRequired: o.pickupCodeRequired === true,
      verified: o.pickupCodeVerifiedAt != null,
      cutlery,
      cutleryLabel: cutlery ? 'Send cutlery' : '',
    };
  }

  function isValidPickupCode(value) {
    return OTP_REGEX.test(String(value == null ? '' : value).trim());
  }


  /* ---- Doorstep payment (UPI vs cash on delivery) ---------------------------
   * The backend attaches a normalized `payment` view (services/orderPaymentView
   * .js) to every rider order. When present it is authoritative — it is the only
   * source that knows about a partial-COD advance, and it is what the customer
   * sees. The local derivation is kept only as a fallback for a stale cached
   * order object that predates the view. */
  function paymentDoorstep(order) {
    const o = order || {};
    const view = o.payment && typeof o.payment === 'object' ? o.payment : null;
    if (view) {
      const isCod = view.isCod === true;
      const cashToCollect = Number(view.cashToCollect) || 0;
      const label = String(view.label || '');
      const amount = isCod ? cashToCollect : (Number(view.orderTotal) || 0);
      return {
        isCod,
        method: String(view.method || '').toUpperCase() || (isCod ? 'COD' : 'UPI'),
        amount,
        orderTotal: Number(view.orderTotal) || 0,
        advanceRequired: Number(view.advanceRequired) || 0,
        advancePaid: Number(view.advancePaid) || 0,
        isPartialCod: view.isPartialCod === true,
        cashCollected: view.cashCollected === true,
        blocksDelivery: view.blocksDelivery === true,
        blockReason: String(view.blockReason || ''),
        banner: isCod
          ? (label ? '💵 ' + label : '💵 CASH ON DELIVERY: COLLECT ' + rupees(amount, 2) + ' FROM CUSTOMER')
          : '✅ PREPAID ONLINE — DO NOT COLLECT CASH',
        confirmationLabel: isCod ? 'I have collected ' + rupees(amount, 2) + ' in cash from the customer' : '',
        requiresCashConfirmation: isCod,
        source: 'backend',
      };
    }

    const method = String(o.paymentMethod || '').trim().toUpperCase();
    const cod = method === 'COD' || method === 'CASH' || o.isCod === true;
    const hit = firstNumber(o, ORDER_TOTAL_FIELDS);
    const amount = hit ? hit.value : (Number(o.codAmount) || 0);
    return {
      isCod: cod,
      method: method || 'UNKNOWN',
      amount,
      orderTotal: amount,
      advanceRequired: 0,
      advancePaid: 0,
      isPartialCod: false,
      cashCollected: false,
      blocksDelivery: false,
      blockReason: '',
      banner: cod
        ? '💵 CASH ON DELIVERY: COLLECT ' + rupees(amount, 2) + ' FROM CUSTOMER'
        : '✅ PREPAID ONLINE — DO NOT COLLECT CASH',
      confirmationLabel: cod ? 'I have collected ' + rupees(amount, 2) + ' in cash from the customer' : '',
      requiresCashConfirmation: cod,
      source: 'local',
    };
  }


  /* ---- Per-order earning breakdown and settlement --------------------------- */
  const EARNING_COMPONENT_FIELDS = {
    base: ['baseDeliveryPay', 'baseDeliveryEarning', 'basePay', 'baseEarning', 'deliveryFeeEarning'],
    distance: ['distancePay', 'distanceEarning', 'distanceBonus', 'mileagePay'],
    surge: ['rainSurgeBonus', 'surgeBonus', 'peakSurgeBonus', 'rainBonus', 'surgeEarning'],
    wait: ['waitTimePay', 'restaurantWaitPay', 'waitingPay', 'waitTimeEarning', 'waitCompensation'],
  };

  /* Component lines for one order. The backend freezes the split on the order
   * as `riderEarningBreakdown` = { basePay, distancePay, rainSurgeBonus,
   * waitTimePay, tip, total } (see models/Order.js + riderEarningService.js), so
   * that nested object is read first and is authoritative. Flat aliases are kept
   * only as a fallback for older payloads. A component the backend did not send
   * stays null (rendered as "—"); nothing is filled in from a policy here. */
  function earningBreakdown(order) {
    const o = order || {};
    const frozen = o.riderEarningBreakdown && typeof o.riderEarningBreakdown === 'object' ? o.riderEarningBreakdown : null;
    const pick = (fields, frozenKey) => {
      if (frozen && frozenKey) {
        const raw = frozen[frozenKey];
        if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) return Number(raw);
      }
      const hit = firstNumber(o, fields);
      return hit ? hit.value : null;
    };
    const tipFromFrozen = frozen && Number.isFinite(Number(frozen.tip)) ? Number(frozen.tip) : null;
    const tipHit = pickCustomerTip(o);
    const waitHit = firstNumber(o, ['riderWaitTimeMinutes', 'waitTimeMinutes', 'restaurantWaitMinutes']);
    const waitMinutes = waitHit ? waitHit.value : null;
    const totalHit = pickRiderEarning(o);
    const lines = [
      { id: 'base', label: 'Base Delivery Pay', value: pick(EARNING_COMPONENT_FIELDS.base, 'basePay'), hint: '' },
      { id: 'distance', label: 'Distance Pay', value: pick(EARNING_COMPONENT_FIELDS.distance, 'distancePay'), hint: '' },
      { id: 'surge', label: 'Rain / Surge Bonus', value: pick(EARNING_COMPONENT_FIELDS.surge, 'rainSurgeBonus'), hint: '' },
      { id: 'wait', label: 'Restaurant Wait-Time Pay', value: pick(EARNING_COMPONENT_FIELDS.wait, 'waitTimePay'), hint: waitMinutes == null ? '' : waitMinutes + ' mins waited' },
      { id: 'tip', label: 'Customer Tip (100%)', value: tipFromFrozen != null ? tipFromFrozen : (tipHit ? tipHit.value : null), hint: '' },
    ];
    const known = lines.filter(l => l.value != null);
    const sum = known.reduce((s, l) => s + l.value, 0);
    return {
      lines,
      waitMinutes,
      hasAny: known.length > 0,
      complete: known.length === lines.length,
      componentSum: known.length ? sum : null,
      total: totalHit ? totalHit.value : (known.length === lines.length ? sum : null),
    };
  }

  /* Pocketbook: what Eatswada owes the rider, less the COD cash the rider is
   * still holding for the customer. */
  function settlementSummary(input) {
    const i = input || {};
    const totalEarnings = Math.max(0, Number(i.totalEarnings) || 0);
    const cashInHand = Number(i.cashInHand) || 0;
    const net = totalEarnings - cashInHand;
    const positive = net >= 0;
    return {
      totalEarnings,
      cashInHand,
      net,
      tone: positive ? 'ok' : 'warn',
      label: positive
        ? 'Net Payout Due to You: +' + rupees(Math.abs(net))
        : 'Net COD Cash Due to Admin: -' + rupees(Math.abs(net)),
      payouts: Array.isArray(i.payouts) ? i.payouts : [],
      deposits: Array.isArray(i.deposits) ? i.deposits : [],
    };
  }

  /* A payout/deposit row is only shown when it carries a real reference or
   * amount; the app never prints an empty ledger line. */
  function ledgerRows(entries) {
    return (Array.isArray(entries) ? entries : [])
      .filter(e => e && (firstNumber(e, ['amount', 'value']) || e.utr || e.reference || e.referenceId || e.date || e.createdAt))
      .map(e => {
        const hit = firstNumber(e, ['amount', 'value']);
        return {
          amount: hit ? hit.value : null,
          amountText: hit ? rupees(hit.value) : '—',
          reference: String(e.utr || e.reference || e.referenceId || '').trim(),
          date: String(e.date || e.createdAt || e.paidAt || e.depositedAt || '').trim(),
          status: String(e.status || '').trim(),
        };
      });
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

  /* Weekly-incentive wording. `backendAmount` comes from GET /api/riders/earnings
   * (weeklyIncentive) and is authoritative, so it is shown as confirmed money.
   * Without it the documented ladder is shown as a target and clearly marked
   * approximate — it is never presented as money already unlocked. */
  function incentiveDisplay(incentive, backendAmount, formatMoney) {
    const w = incentive || weeklyIncentive(0);
    const fmt = typeof formatMoney === 'function' ? formatMoney : (n => '₹' + n);
    if (backendAmount != null && Number.isFinite(Number(backendAmount))) {
      const amount = Number(backendAmount);
      return {
        amountText: fmt(amount),
        earnedText: amount > 0 ? fmt(amount) + ' earned this week — confirmed by Eatswada' : 'No incentive earned yet this week',
        approximate: false,
        confirmed: true,
      };
    }
    return {
      amountText: fmt(w.amount),
      earnedText: 'Target: ' + fmt(w.amount) + ' at ' + (w.milestone || 10) + ' deliveries — approximate',
      approximate: true,
      confirmed: false,
    };
  }


  /* ========================================================================
   * Route, guaranteed payout, expenses and the settlement ledger.
   *
   * The backend is the single source of truth for distances, ETAs, payouts,
   * fuel/maintenance and net earnings. Nothing in this section computes those
   * from raw coordinates or a local formula: every function only *reads* the
   * value the backend returned and formats it. When a field is absent the
   * result carries `null` (the page renders an honest "unavailable"), never a
   * fabricated number. This is what keeps the rider app from inventing money.
   * ====================================================================== */

  /* Money in paise, integer math only, so there is no float drift. */
  function formatPaise(paise) {
    const n = Math.round(Number(paise) || 0);
    const negative = n < 0;
    const abs = Math.abs(n);
    const major = Math.floor(abs / 100);
    const minor = abs % 100;
    const grouped = major.toLocaleString('en-IN');
    const body = minor ? grouped + '.' + String(minor).padStart(2, '0') : grouped;
    return '₹' + (negative ? '-' : '') + body;
  }

  function paiseToRupees(paise) {
    const n = optionalNumber(paise);
    return n == null ? null : Math.round(n) / 100;
  }

  /* Distances: km, at most one decimal unless the backend explicitly supplies
   * a precision. A missing value returns null (the caller shows "unavailable"). */
  function formatDistance(km, precision) {
    const n = optionalNumber(km);
    if (n == null || n < 0) return null;
    const raw = Number(precision);
    const d = Number.isFinite(raw) ? Math.max(0, Math.min(2, Math.floor(raw))) : 1;
    return n.toFixed(d) + ' km';
  }

  /* Times: minutes, rolled up to hours only past 60. */
  function formatMinutes(minutes) {
    const n = optionalNumber(minutes);
    if (n == null || n < 0) return null;
    const m = Math.round(n);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? h + ' h ' + r + ' min' : h + ' h';
  }

  /* Rejects null/''/undefined before Number(), because Number(null) is 0 and
   * would turn a missing money field into a real ₹0. */
  function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /* ---- Route info (backend route-distance service) -------------------------
   * The service is assumed to attach `route.{pickup,delivery,total}` with
   * distanceKm/durationMinutes (OQ2). Flat aliases are read as a fallback.
   * `route.available === false` (or routeEstimateUnavailable) means the service
   * could not produce a route — the page must say so and never block the rider
   * with a fake number. Nothing here sums the legs: the total is only shown
   * when the backend returned it. */
  function routeLeg(order, nestedName, flatDistance, flatDuration) {
    const o = order || {};
    const route = o.route && typeof o.route === 'object' ? o.route : null;
    const nested = route && route[nestedName] && typeof route[nestedName] === 'object' ? route[nestedName] : null;
    let distanceKm = null;
    let durationMinutes = null;
    if (nested) {
      distanceKm = optionalNumber(nested.distanceKm);
      if (distanceKm == null) distanceKm = optionalNumber(nested.distance);
      durationMinutes = optionalNumber(nested.durationMinutes);
      if (durationMinutes == null) durationMinutes = optionalNumber(nested.etaMinutes);
      if (durationMinutes == null) durationMinutes = optionalNumber(nested.duration);
    }
    if (distanceKm == null) { const hit = firstNumber(o, flatDistance); if (hit) distanceKm = hit.value; }
    if (durationMinutes == null) { const hit = firstNumber(o, flatDuration); if (hit) durationMinutes = hit.value; }
    return {
      distanceKm,
      durationMinutes,
      distanceText: formatDistance(distanceKm),
      durationText: formatMinutes(durationMinutes),
      available: distanceKm != null || durationMinutes != null,
    };
  }

  function routeInfo(order) {
    const o = order || {};
    const route = o.route && typeof o.route === 'object' ? o.route : null;
    const unavailable = o.routeEstimateUnavailable === true || (route ? route.available === false : false);
    return {
      unavailable,
      pickup: routeLeg(o, 'pickup', ['pickupDistanceKm', 'pickupDistance', 'riderToRestaurantKm', 'distanceToRestaurantKm'], ['pickupEtaMinutes', 'pickupDurationMinutes', 'pickupEta']),
      delivery: routeLeg(o, 'delivery', ['deliveryDistanceKm', 'deliveryDistance', 'restaurantToCustomerKm'], ['deliveryEtaMinutes', 'deliveryDurationMinutes', 'deliveryEta']),
      total: routeLeg(o, 'total', ['totalDistanceKm', 'tripDistanceKm'], ['totalEtaMinutes', 'tripDurationMinutes', 'totalDurationMinutes', 'totalEta']),
    };
  }

  /* ---- Guaranteed payout (Dynamic Rider Payout Engine) ---------------------
   * A guaranteed figure is one the backend has committed to. An estimate is
   * labelled as such and is never presented as the payout. The app must not
   * derive either from the order total or a local fee formula. */
  function payoutComponents(order) {
    const o = order || {};
    const q = o.payoutQuote && typeof o.payoutQuote === 'object' ? o.payoutQuote : null;
    const g = o.payoutGuarantee && typeof o.payoutGuarantee === 'object' ? o.payoutGuarantee : null;
    const nested = (q && q.components && typeof q.components === 'object') ? q.components
      : ((g && g.components && typeof g.components === 'object') ? g.components : null);
    const pick = (nestedKey, fields) => {
      if (nested) {
        const v = optionalNumber(nested[nestedKey]);
        if (v != null) return v;
      }
      const hit = firstNumber(o, fields);
      return hit ? hit.value : null;
    };
    const defs = [
      ['pickup', 'Pickup compensation', ['pickupPay', 'pickupCompensation', 'pickupFee']],
      ['delivery', 'Delivery compensation', ['deliveryPay', 'deliveryCompensation', 'deliveryFee']],
      ['repositioning', 'Repositioning allowance', ['repositioningPay', 'repositioningCompensation', 'repositioningAllowance']],
      ['waiting', 'Waiting compensation', ['waitingCompensation', 'waitCompensation', 'waitingPay']],
      ['peakHour', 'Peak-hour allowance', ['peakHourBonus', 'peakHourPay', 'peakBonus']],
      ['remoteZone', 'Remote-zone allowance', ['remoteZoneBonus', 'remoteZoneAllowance', 'zoneBonus']],
    ];
    const lines = defs
      .map(([id, label, fields]) => ({ id, label, value: pick(id, fields) }))
      .filter(l => l.value != null)
      .map(l => ({ id: l.id, label: l.label, value: l.value, valueText: moneyText(l.value) }));
    return { lines, hasAny: lines.length > 0 };
  }

  function payoutGuarantee(order) {
    const o = order || {};
    const q = o.payoutQuote && typeof o.payoutQuote === 'object' ? o.payoutQuote : null;
    const g = o.payoutGuarantee && typeof o.payoutGuarantee === 'object' ? o.payoutGuarantee : null;

    let amount = null;
    let guaranteed = false;
    let source = null;

    const guaranteedCandidates = [
      optionalNumber(o.guaranteedPayout),
      optionalNumber(o.guaranteedEarning),
      g ? optionalNumber(g.guaranteed) : null,
      g ? optionalNumber(g.amount) : null,
      g ? optionalNumber(g.total) : null,
      q ? optionalNumber(q.guaranteed) : null,
      q ? optionalNumber(q.guaranteedPayout) : null,
    ];
    const firstGuaranteed = guaranteedCandidates.find(v => v != null);
    if (firstGuaranteed != null) {
      amount = firstGuaranteed;
      guaranteed = true;
      source = 'guaranteed';
    } else {
      const estimatedCandidates = [
        optionalNumber(o.estimatedPayout),
        q ? optionalNumber(q.estimated) : null,
        q ? optionalNumber(q.estimatedPayout) : null,
        q ? optionalNumber(q.amount) : null,
        g ? optionalNumber(g.estimated) : null,
      ];
      const firstEstimated = estimatedCandidates.find(v => v != null);
      if (firstEstimated != null) {
        amount = firstEstimated;
        guaranteed = false;
        source = 'estimated';
      }
    }

    const confirmedCandidates = [
      q ? optionalNumber(q.confirmed) : null,
      q ? optionalNumber(q.confirmedPayout) : null,
      g ? optionalNumber(g.confirmed) : null,
      g ? optionalNumber(g.confirmedPayout) : null,
      optionalNumber(o.confirmedPayout),
      optionalNumber(o.confirmedEarning),
    ];
    const confirmed = confirmedCandidates.find(v => v != null) ?? null;

    const components = payoutComponents(o);
    return {
      amount,
      guaranteed,
      source,
      confirmed,
      components,
      hasQuote: amount != null,
      hasConfirmed: confirmed != null,
      amountText: amount == null ? null : moneyText(amount),
      confirmedText: confirmed == null ? null : moneyText(confirmed),
    };
  }

  /* The invariant: once accepted, the confirmed payout may rise but must never
   * fall below the offered guarantee. A decrease is surfaced as an error state
   * (the page shows it and reports it) and is never silently displayed. Money
   * is compared in paise so there is no float drift. */
  function payoutReconciliation(offered, confirmed) {
    const off = optionalNumber(offered);
    const conf = optionalNumber(confirmed);
    if (conf == null) {
      return { known: false, state: 'unknown', offered: off, confirmed: null, delta: null, deltaText: null, message: '' };
    }
    if (off == null) {
      return { known: true, state: 'confirmed', offered: null, confirmed: conf, delta: null, deltaText: null, message: 'Guaranteed payout confirmed at ' + moneyText(conf) + '.' };
    }
    const deltaPaise = Math.round(conf * 100) - Math.round(off * 100);
    if (deltaPaise < 0) {
      return {
        known: true, state: 'decrease', offered: off, confirmed: conf,
        delta: deltaPaise / 100, deltaText: formatPaise(Math.abs(deltaPaise)),
        message: 'The confirmed payout is lower than the guaranteed offer. This must not happen — it has been flagged for Eatswada support and is not applied silently.',
      };
    }
    if (deltaPaise > 0) {
      return {
        known: true, state: 'increase', offered: off, confirmed: conf,
        delta: deltaPaise / 100, deltaText: formatPaise(deltaPaise),
        message: 'Payout increased by ' + formatPaise(deltaPaise) + ' — now ' + moneyText(conf) + '.',
      };
    }
    return { known: true, state: 'same', offered: off, confirmed: conf, delta: 0, deltaText: null, message: 'Guaranteed payout confirmed at ' + moneyText(conf) + '.' };
  }

  /* ---- Offer expiry (authoritative) ----------------------------------------
   * The countdown uses the backend's expiry when it supplies one; the page
   * still treats a late Accept as "no longer available" from the server. */
  function offerExpiry(order, now) {
    const o = order || {};
    const at = Date.parse(o.offerExpiresAt || o.assignmentExpiresAt || o.expiresAt);
    if (!Number.isFinite(at)) return { known: false, ms: null, seconds: 0, expired: false, text: '' };
    const t = now == null ? Date.now() : now;
    const ms = at - t;
    const expired = ms <= 0;
    const total = Math.max(0, Math.ceil(ms / 1000));
    return { known: true, ms, seconds: total, expired, text: expired ? 'Offer expired' : 'Expires in ' + total + 's' };
  }

  /* One call the offer card makes, so the page never composes its own numbers. */
  function offerDetails(order, now) {
    const o = order || {};
    const route = routeInfo(o);
    return {
      payout: payoutGuarantee(o),
      route,
      expiry: offerExpiry(o, now),
      routeUnavailable: route.unavailable,
      tip: pickCustomerTip(o),
    };
  }

  /* ---- Waiting compensation (backend decides eligibility and amount) ------- */
  function waitingCompensationInfo(order, now) {
    const o = order || {};
    const w = waitTimeInfo(o, now);
    const hit = firstNumber(o, ['waitingCompensation', 'waitCompensation', 'waitTimeCompensation', 'waitingEarnings', 'waitingPay']);
    const amount = hit ? hit.value : null;
    return {
      active: w.active,
      minutes: w.minutes,
      seconds: w.seconds,
      thresholdMinutes: w.thresholdMinutes,
      /* `eligible` is only the local "past the threshold" hint; the amount is
         strictly the backend figure, so it stays null until the backend sends it. */
      eligible: w.compensationApplies,
      amount,
      amountText: amount == null ? null : moneyText(amount),
      text: w.text,
      note: w.note,
    };
  }

  /* ---- Address / route change after assignment -----------------------------
   * `acknowledgedAt` is the timestamp the rider last saw, so the banner clears
   * once acknowledged. The payout on a route change may rise but never fall —
   * the caller re-runs payoutReconciliation with the new figure. */
  function routeChangeInfo(order, acknowledgedAt) {
    const o = order || {};
    const at = o.routeUpdatedAt || o.deliveryAddressChangedAt || o.addressChangedAt || o.routeChangedAt || null;
    const atMs = Date.parse(at);
    if (!Number.isFinite(atMs)) return { changed: false, at: null, reason: '', compensation: null, compensationText: null, message: '' };
    const ackMs = Date.parse(acknowledgedAt);
    const changed = !Number.isFinite(ackMs) || atMs > ackMs;
    const reason = String(o.routeChangeReason || o.addressChangeReason || '').trim();
    const hit = firstNumber(o, ['routeChangeCompensation', 'addressChangeCompensation', 'routeChangePay']);
    const compensation = hit ? hit.value : null;
    return {
      changed,
      at,
      reason,
      compensation,
      compensationText: compensation == null ? null : moneyText(compensation),
      message: changed
        ? 'Delivery address or route updated.' + (reason ? ' ' + reason + '.' : '')
        : '',
    };
  }

  /* ---- Reassignment / cancellation ----------------------------------------- */
  function assignmentEndInfo(order) {
    const o = order || {};
    const st = String(o.status || '');
    const rs = String(o.riderStatus || '');
    const cancelled = st === 'cancelled' || o.cancelled === true || o.cancelledAt != null;
    const reassigned = !cancelled && (rs === 'unassigned' || o.reassigned === true || o.assignmentCancelled === true || String(o.reassignmentReason || '').trim() !== '');
    if (!cancelled && !reassigned) return { ended: false, kind: '', message: '', compensation: null, compensationText: null };
    const hit = firstNumber(o, cancelled
      ? ['cancellationCompensation', 'cancelledCompensation', 'cancelCompensation']
      : ['reassignmentCompensation', 'reassignCompensation']);
    const compensation = hit ? hit.value : null;
    const reason = String(o.cancellationReason || o.reassignmentReason || o.assignmentCancelledReason || '').trim();
    return {
      ended: true,
      kind: cancelled ? 'cancelled' : 'reassigned',
      message: cancelled
        ? 'This delivery was cancelled by Eatswada.' + (reason ? ' Reason: ' + reason + '.' : '')
        : 'This delivery was reassigned to another rider.' + (reason ? ' Reason: ' + reason + '.' : ''),
      compensation,
      compensationText: compensation == null ? null : moneyText(compensation),
    };
  }

  /* ---- Earnings summary with estimated expenses ----------------------------
   * Gross, estimated fuel, maintenance allowance, estimated net, deliveries,
   * incentives and waiting compensation for one period block. Every figure is
   * read from the backend; nothing is derived. */
  function earningsSummary(block) {
    const b = block || {};
    const grossHit = firstNumber(b, ['earnings', 'grossEarnings', 'gross', 'totalEarnings']);
    const fuelHit = firstNumber(b, ['estimatedFuelExpense', 'fuelExpense', 'estimatedFuel', 'fuelCost']);
    const maintHit = firstNumber(b, ['maintenanceAllowance', 'maintenance', 'estimatedMaintenance']);
    const netHit = firstNumber(b, ['estimatedNetEarnings', 'netEarnings', 'net']);
    const incHit = firstNumber(b, ['incentives', 'incentive', 'incentiveEarnings', 'weeklyIncentive']);
    const waitHit = firstNumber(b, ['waitingCompensation', 'waitCompensation', 'waitingEarnings', 'waitTimePay']);
    const gross = grossHit ? grossHit.value : null;
    const fuel = fuelHit ? fuelHit.value : null;
    const maintenance = maintHit ? maintHit.value : null;
    const net = netHit ? netHit.value : null;
    const incentives = incHit ? incHit.value : null;
    const waiting = waitHit ? waitHit.value : null;
    return {
      gross,
      fuel,
      maintenance,
      net,
      incentives,
      waiting,
      deliveries: earningsOrderCount(b),
      hasExpenses: fuel != null || maintenance != null,
      grossText: gross == null ? null : moneyText(gross),
      fuelText: fuel == null ? null : moneyText(fuel),
      maintenanceText: maintenance == null ? null : moneyText(maintenance),
      netText: net == null ? null : moneyText(net),
      incentivesText: incentives == null ? null : moneyText(incentives),
      waitingText: waiting == null ? null : moneyText(waiting),
    };
  }

  /* ---- Settlement ledger ---------------------------------------------------
   * Entries carry date/type/amount/status. A reversal is its own entry and is
   * never hidden or altered: it is flagged and shown as a negative amount. */
  const LEDGER_STATUSES = ['pending', 'settled', 'reversed'];
  function ledgerEntryRows(entries) {
    return (Array.isArray(entries) ? entries : []).filter(Boolean).map(e => {
      const hit = firstNumber(e, ['amount', 'value', 'netAmount']);
      const status = String(e.status || '').trim().toLowerCase();
      const type = String(e.type || e.kind || e.entryType || '').trim();
      const reversal = e.reversed === true || status === 'reversed' || type.toLowerCase() === 'reversal';
      const amount = hit ? hit.value : null;
      return {
        date: String(e.date || e.createdAt || e.settledAt || '').trim(),
        type,
        status,
        reversal,
        amount,
        amountText: amount == null ? '—' : moneyText(amount),
        signedText: amount == null ? '—' : (reversal && amount > 0 ? '-' + moneyText(amount) : moneyText(amount)),
        reference: String(e.reference || e.utr || e.referenceId || '').trim(),
        label: String(e.label || e.description || '').trim(),
        tone: reversal ? 'reversal' : (LEDGER_STATUSES.includes(status) ? status : ''),
      };
    });
  }

  function paginationInfo(data) {
    const d = data || {};
    const page = Math.max(1, Math.floor(Number(d.page) || 1));
    const pages = Math.max(1, Math.floor(Number(d.pages) || 1));
    const total = optionalNumber(d.total);
    return { page, pages, total, hasMore: page < pages };
  }

  /* ---- Idempotency ---------------------------------------------------------
   * A unique key per state change so a retry after a timeout cannot duplicate
   * an action (accept, picked up, delivered, COD collected). Sent as the
   * Idempotency-Key header (OQ6); the page also keeps an in-flight guard. */
  function idempotencyKey(prefix) {
    const p = prefix == null ? '' : String(prefix);
    let rand = null;
    try {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') rand = globalThis.crypto.randomUUID();
    } catch { rand = null; }
    if (!rand) {
      rand = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : ((r & 0x3) | 0x8);
        return v.toString(16);
      });
    }
    return (p ? p + ':' : '') + rand;
  }

  return {
    VEHICLE_TYPES,
    APPLICATION_STATUSES,
    ACTIVE_RIDER_STATUSES,
    PICKUP_ALLOWED_ORDER_STATUSES,
    KITCHEN_RELEASED_STATUSES,
    PHONE_REGEX,
    EMAIL_REGEX,
    OTP_REGEX,
    MAX_APPLICATION_REF_AGE_MS,
    RIDER_EARNING_FIELDS,
    ORDER_TOTAL_FIELDS,
    OFFER_POLICY,
    REJECTION_LIMIT,
    REJECTION_COOLDOWN_MINUTES,
    COD_CASH_LIMIT_DEFAULT,
    GEOFENCE_RADIUS_M,
    WAIT_COMPENSATION_MINUTES,
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
    backendWeeklyIncentive,
    earningsOrderCount,
    rupees,
    rainSurgeInfo,
    rejectionWarning,
    cooldownRemaining,
    rejectionTracker,
    codCashStatus,
    coordinatesOf,
    restaurantCoordinates,
    haversineMeters,
    geofenceStatus,
    pickupGeofence,
    waitTimeInfo,
    kitchenReadyInfo,
    pickupHandover,
    isValidPickupCode,
    paymentDoorstep,
    earningBreakdown,
    settlementSummary,
    ledgerRows,
    createInFlightGuard,
    nextDeliveryStep,
    homeAlerts,
    incentiveDisplay,
    /* Route, guaranteed payout, expenses, ledger, idempotency + formatters. */
    formatPaise,
    paiseToRupees,
    moneyText,
    formatDistance,
    formatMinutes,
    optionalNumber,
    routeLeg,
    routeInfo,
    payoutComponents,
    payoutGuarantee,
    payoutReconciliation,
    offerExpiry,
    offerDetails,
    waitingCompensationInfo,
    routeChangeInfo,
    assignmentEndInfo,
    earningsSummary,
    ledgerEntryRows,
    paginationInfo,
    idempotencyKey,
    LEDGER_STATUSES,
  };
});
