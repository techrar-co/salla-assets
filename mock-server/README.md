# Salla Mock Server

Local mock for Salla APIs + webhook delivery. This is a standalone Node/Express app so the Core/Order repos stay clean.

## Quick start
```bash
cd /Users/ziaurrehmankhan/Documents/techrar/salla-mock
npm install
npm start
```

Default: `http://localhost:9900`

## .env support
The mock now loads a local `.env` file automatically via `dotenv`.

## Usage with Core/Order (env overrides)
Point Core and Order APIs to the mock Salla server:
```bash
export SALLA_ACCOUNTS_BASE_URL=http://localhost:9900
export SALLA_API_BASE_URL=http://localhost:9900/admin/v2
export SALLA_WEBHOOK_TOKEN=dev_salla_token
```

## What it mocks
Accounts endpoints:
- `GET /oauth2/user/info`
- `POST /oauth2/token`

Admin endpoints (used by Order/Core):
- `GET /admin/v2/orders/:id`
- `GET /admin/v2/orders/items?order_id=...`
- `GET /admin/v2/products/:id`
- `POST /admin/v2/apps/:id/settings`
- `PUT /admin/v2/settings/fields/enable_recurring_payment`
- `POST /admin/v2/webhooks/subscribe`
- `POST /admin/v2/subscriptions/:id/charge`
- `DELETE /admin/v2/subscriptions/:id`

Webhook sender (subscription events only):
- `POST /mock/webhook`
- `POST /mock/scenario`

## Environment variables
- `PORT` (default `9900`)
- `SALLA_MOCK_REQUIRE_AUTH` (default `true`) — if true, requires `Authorization` header
- `SALLA_MOCK_EXPECTED_TOKEN` — optional exact token check
- `SALLA_MOCK_MERCHANT_ID`, `SALLA_MOCK_MERCHANT_NAME`
- `SALLA_MOCK_USER_NAME`, `SALLA_MOCK_MOBILE`, `SALLA_MOCK_MOBILE_CODE`, `SALLA_MOCK_EMAIL`
- `SALLA_MOCK_SCOPE` (default `read write`)
- `SALLA_MOCK_ORDER_TEMPLATE` — path to JSON order snapshot (customer data only)
- `CORE_WEBHOOK_URL` (default `http://localhost:8001/integrations/salla/webhooks/`)
- `ORDER_WEBHOOK_URL` (default `http://localhost:8000/order/v1/salla/`)
- `SALLA_WEBHOOK_TOKEN` — used when the mock sends webhooks to your APIs
- `SALLA_MOCK_WEBHOOK_TIMEOUT` (ms, default `10000`)
- `SALLA_MOCK_SEND_CHARGE_SUCCEEDED` (default `false`) — if true, charge endpoint emits `subscription.charge.succeeded`, otherwise emits `subscription.charge.failed`
- `SALLA_MOCK_AUTO_CANCEL_WEBHOOK` (default `false`) — if true, emits `subscription.cancelled` on delete

## Sending webhooks
Note: The mock intentionally does **not** emit `order.created` webhooks because
the Order API now relies on `subscription.created` + the order-items endpoint.

### Single webhook
```bash
curl -s -X POST http://localhost:9900/mock/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "target": "core",
    "event": "app.store.authorize",
    "overrides": {
      "merchant_id": "1793723426",
      "access_token": "mock_access",
      "refresh_token": "mock_refresh"
    }
  }'
```

### Full scenario
```bash
curl -s -X POST http://localhost:9900/mock/scenario \
  -H 'Content-Type: application/json' \
  -d '{
    "merchant_id": "1793723426",
    "app_id": 1234567890,
    "reference_order_id": "1754307967",
    "include_failed": false,
    "include_cancel": true,
    "include_uninstall": true
  }'
```

## Customizing mock data
- Override order snapshot (customer info):
  - `POST /mock/orders/:id`
- Override order items payload:
  - `POST /mock/orders/:id/items`

Both endpoints accept either a raw object/array or `{ "data": ... }`.

## Mobile normalization note
The mock normalizes `SALLA_MOCK_MOBILE` to the local Salla format (e.g. `9665xxxxxxx` → `5xxxxxxxx`)
when building the order snapshot, and uses `SALLA_MOCK_MOBILE_CODE` for the country code.

## Important: routing Core/Order outbound calls
Your Core/Order apps currently call real Salla domains (`https://accounts.salla.sa` and `https://api.salla.dev`).
To have them hit this mock **without code changes**, you must redirect those domains to your local mock server.

Two approaches:
1) **Host mapping + HTTPS (no code changes, more setup)**
   - Map `accounts.salla.sa` and `api.salla.dev` to `127.0.0.1` in `/etc/hosts`.
   - Run this mock server with HTTPS on port `443` using a locally trusted cert for those domains.
   - This is the only way to keep the apps completely unchanged.

2) **Tiny env overrides in Core/Order (simpler)**
   - If you later allow small changes, we can add env overrides so the apps call `http://localhost:9900` directly.

If you want, I can add HTTPS support + cert instructions, or re-introduce the minimal env overrides.
