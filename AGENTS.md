# AGENTS.md — Eatswada Rider (Android app)

Repository-specific guidance for AI agents working on this app.

## What this project is

Vanilla-JS, multi-page web app packaged for Android with Capacitor. There is
**no framework, no bundler, and no build step for the web code** — the HTML
files are the source of truth and are copied verbatim into `www/`.

- `login.html` — rider login (`POST /api/auth/rider/login`).
- `index.html` — rider dashboard (orders, GPS, earnings, profile, OTP).
- `apply.html` — "Become a Delivery Partner" application + status check.
- `rider-logic.js` — pure, shared business rules (also loaded by the Node tests).
- `native-push.js` / `native-push-rider.js` — Capacitor push bridge.
- `scripts/prepare-www.mjs` — stages the app files into `www/` for Capacitor.

Do **not** migrate to React/Next or introduce a bundler. Keep changes small and
backward compatible.

## Backend

Live at `https://api.eatswada.com`. **Never fabricate endpoints or fields** —
verify against the backend before using them. Endpoints the app relies on:

- `POST /api/auth/rider/login` — `{ phone|email, password }` → `{ token, user }`.
- `POST /api/rider-applications` — submit a rider application (rate limited).
- `GET /api/rider-applications/:id/status?phone=…` — application status.
- `GET/PUT /api/riders/profile`, `PUT /api/riders/profile/photo`.
- `GET /api/riders/orders?page=&limit=`, `GET /api/riders/orders/history`.
- `GET /api/riders/orders/:id`, `PUT /api/riders/orders/:id/status`.
- `POST /api/riders/orders/:id/verify-otp`, `POST /api/riders/orders/:id/delivery-issue`.
- `PUT /api/riders/status` (`{ isOnline }`), `PUT /api/riders/location` (`{ lat, lng }`).
- `GET /api/riders/earnings`.
- `POST /api/notifications/register-token`, `POST /api/notifications/unregister-token`.

Known contract notes (verified):
- `activeOnly=true` on the orders list is **not** a real parameter — do not add it.
- Rider order status flow: `unassigned → assigned → accepted → reached_restaurant
  → picked_up → out_for_delivery → delivered`.
- Kitchen `Order.status` is separate: `placed, confirmed, preparing,
  waiting_for_rider, assigned, out_for_delivery, otp_verified, delivered, cancelled`.
- Vehicle type enum: `bike | scooter | bicycle | car`.
- Delivery OTP is 4 digits. Pickup must be blocked until the kitchen releases the
  order (`waiting_for_rider`/`assigned`/`otp_verified`).
- Dispatch/assignment is backend-only. The app must never assign a rider, and
  there is **no rider reject endpoint** — do not invent one.

## Security

- Never log or persist passwords. Store only the minimum application reference
  (`id`, `phone`, `status`, `name`, `savedAt`) under `eatswada_rider_application`.
- The Firebase web config in `index.html` is a public client config; never add
  service-account keys or private keys.
- Do not commit `www/`, `android/`, `node_modules/`.

## Testing

```
npm run check     # lint (inline-script syntax + node --check) then tests
npm test          # node --test "tests/*.test.mjs"
npm run android:prepare   # stage www/ for Capacitor
```

Tests live in `tests/` and cover `rider-logic.js` rules, page wiring/contracts,
and the native push bridge. Prefer pure functions in `rider-logic.js` so new
rules are testable without a browser. Do not claim a test passed unless you ran it.
