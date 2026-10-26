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
  };
});
