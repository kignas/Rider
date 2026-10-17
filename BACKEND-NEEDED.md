# Backend work needed (app already handles "missing" gracefully)
Optional endpoints the new More tab tries; a 404 just hides that part:
- GET /api/riders/cash    -> { data: { cashInHand } }  (COD collected minus deposits)
- GET /api/riders/payouts -> { data: { payouts: [{ date, amount, status }] } }
- GET /api/riders/profile should include `rating` (number) for the rating card.
Not built (needs backend + more work): reject order, masked calling, document/KYC upload in apply, incentives engine, in-app navigation.
Set SUPPORT_PHONE at the top of rider-extras.js.
