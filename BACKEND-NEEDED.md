# Backend work needed (app already handles "missing" gracefully)

The rider app is synchronised with the Zomato-grade backend
(`Eatswada--main`), the Vendor app (`Vendor-main`), the Admin command centre
(`Admin-main`) and the Customer app (`Nearbite-main`). Everything below is
either an **existing** endpoint/payload the app now sends, or an **optional**
endpoint the app tries and hides gracefully on 404.

## Existing endpoints the app now sends extra fields to

### `PUT /api/riders/orders/:id/status`

Body varies by target status. All fields are additive; older backends that
ignore unknown fields keep working.

| Status               | Body                                                 |
| -------------------- | ---------------------------------------------------- |
| `accepted`           | `{ status: 'accepted' }`                             |
| `reached_restaurant` | `{ status: 'reached_restaurant', lat, lng }`         |
| `picked_up`          | `{ status: 'picked_up', pickupCode, pickupPhotoUrl }`|
| `out_for_delivery`   | `{ status: 'out_for_delivery' }`                     |
| `delivered`          | `{ status: 'delivered', codCashCollected }`          |

- `lat`, `lng` (numbers) — the rider's live GPS fix, sent so the backend can
  enforce the **200 m pickup geofence** instead of trusting the client. When the
  backend rejects the arrival it must answer **400** with a human-readable
  `message` containing the distance (e.g. `"You are 340m from the restaurant;
  move within 200m"`). The app surfaces that message verbatim.
- `pickupCode` (string, 4 digits) — the counter handover code the rider reads off
  the bag. Sent only when the order carries one.
- `pickupPhotoUrl` (string, URL) — returned by the optional photo upload below.
- `codCashCollected` (boolean, `true` only) — sent on a COD delivery once the
  rider has confirmed the cash was collected. Omitted for prepaid orders, so
  existing non-COD flows are unchanged.

### `GET /api/riders/orders` and `GET /api/riders/orders/:id`

The app reads these optional fields when present:

- `isRainSurgeActive` (boolean) — drives the `🌧️ Rain Surge Active` header pill.
- `rainSurgeBonus` / `surgeBonus` / `peakSurgeBonus` (number, ₹) — the per-order
  surge bonus, shown in the pill and in the per-order earning breakdown.
- `reachedRestaurantAt` (ISO date) — starts the live wait-time counter.
- `isFoodReady` (boolean) — `true` switches the counter panel to
  `🛍️ ORDER IS PACKED & READY AT COUNTER!` and plays the ready chime.
- `estimatedReadyAt` / `expectedReadyAt` (ISO date) — drives
  `🍳 Kitchen is preparing order (Est. ready: MM:SS)`.
- `pickupCode` (4-digit string) and `sendCutlery` (boolean) — shown at the counter.
- `pickupPhotoRequired` (boolean) — marks the handover photo as required.
- `restaurant.location.coordinates` (`[lng, lat]`) — required for the 200 m
  geofence badge; `restaurantLocation` / `pickupLocation` also accepted.
- `paymentMethod` (`'COD'` or online) and `total` — drive the doorstep banner and
  the COD cash confirmation.

### `GET /api/riders/profile`

`riderDetails` should include:

- `consecutiveRejections` (number) — drives `Rejections: 2/3 — Next rejection
  triggers 15m cooldown`.
- `rejectionLimit` (number, optional; default 3) and `rejectionCooldownMinutes`
  (number, optional; default 15).
- `cooldownUntil` (ISO date) — drives the live `⏸️ Cooldown Active: MM:SS remaining`
  countdown. Absent or in the past hides the banner.
- `isRainSurgeActive` (boolean) — surge is also honoured from the profile.
- `codCashLimit` (number, ₹; optional; default 2000) — the COD ceiling.
- `rating` (number) — for the rating card.

## Optional endpoints the app tries (a 404 just hides that part)

- `GET /api/riders/cash` →
  `{ data: { cashInHand, codCashLimit } }` (COD collected minus deposits).
  Used by the COD Cash in Hand card on Home + Earnings and by the Settlement
  summary. Without it the app sums today's completed COD orders on the device and
  says so.
- `GET /api/riders/payouts` →
  `{ data: { payouts: [{ date, amount, status, utr }], deposits: [{ date, amount, reference }] } }`.
  `utr` is the bank/UPI reference shown in the ledger. `deposits` lists COD cash
  deposits recorded by Admin.
- `GET /api/riders/earnings` — optional `totalEarnings` (number) for the
  Settlement summary; falls back to `today.earnings`.
- `POST /api/riders/orders/:id/pickup-photo` — multipart `photo` field; responds
  `{ url }` (or `{ data: { url } }`). A failure only skips the photo; the pickup
  still goes through with `{ status: 'picked_up' }`.

## Per-order earning breakdown

For the expandable `Rider earning` breakdown the app reads these optional fields
on an order (each falls back to `—`, never an estimate):

- `baseDeliveryPay` (or `baseDeliveryEarning`, `basePay`, `baseEarning`)
- `distancePay` (or `distanceEarning`, `distanceBonus`, `mileagePay`)
- `rainSurgeBonus` (or `surgeBonus`, `peakSurgeBonus`, `rainBonus`)
- `waitTimePay` (or `restaurantWaitPay`, `waitingPay`, `waitTimeEarning`)
- `riderWaitTimeMinutes` (number) — the `N mins waited` hint
- `tipAmount` / `customerTip` / `tipAmountPaise` — customer tip, paid 100% to rider

Wait-time compensation applies after **7 minutes** at the restaurant
(`waitCompensationMinutes` on an order overrides this).

## Push notifications

- `rider_assignment` — new delivery assigned (existing behaviour).
- `order_ready` / `ORDER_READY` — kitchen packed the order. The app plays a
  distinct chime and shows an "Order ready for pickup" notification; the
  notification id lives in a separate space so it never replaces the
  new-assignment alert for the same order.

## Not built (needs backend + more work)

Reject order, masked calling, document/KYC upload in apply, incentives engine,
in-app navigation. There is **no rider reject endpoint** — do not invent one;
riders can only accept or ignore an assignment.

Set `SUPPORT_PHONE` at the top of `rider-extras.js`.
