require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const config = {
  port: Number(process.env.PORT || 9900),
  requireAuth: (process.env.SALLA_MOCK_REQUIRE_AUTH || 'true').toLowerCase() !== 'false',
  expectedAuthToken: process.env.SALLA_MOCK_EXPECTED_TOKEN || '',
  // Defaults mirror the latest real Salla payloads for quick local testing.
  merchantId: process.env.SALLA_MOCK_MERCHANT_ID || '1793723426',
  merchantName: process.env.SALLA_MOCK_MERCHANT_NAME || 'sallapartner2025',
  userName: process.env.SALLA_MOCK_USER_NAME || 'Safwan',
  mobile: process.env.SALLA_MOCK_MOBILE || '534501056',
  mobileCode: process.env.SALLA_MOCK_MOBILE_CODE || '+966',
  email: process.env.SALLA_MOCK_EMAIL || 'safwan9f@gmail.com',
  scope: process.env.SALLA_MOCK_SCOPE || 'read write',
  orderTemplatePath: process.env.SALLA_MOCK_ORDER_TEMPLATE || '',
  coreWebhookUrl: process.env.CORE_WEBHOOK_URL || 'http://localhost:8001/integrations/salla/webhooks/',
  orderWebhookUrl: process.env.ORDER_WEBHOOK_URL || 'http://localhost:8000/order/v1/salla/',
  webhookToken: process.env.SALLA_WEBHOOK_TOKEN || '',
  webhookTimeoutMs: Number(process.env.SALLA_MOCK_WEBHOOK_TIMEOUT || 10000),
  sendChargeSucceeded: (process.env.SALLA_MOCK_SEND_CHARGE_SUCCEEDED || 'false').toLowerCase() === 'true',
  autoCancelWebhook: (process.env.SALLA_MOCK_AUTO_CANCEL_WEBHOOK || 'false').toLowerCase() === 'true',
};

const state = {
  webhooks: [],
  charges: [],
  cancellations: new Map(),
  orders: new Map(),
  orderItems: new Map(),
};

function nowIso() {
  return new Date().toISOString();
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function normalizeSallaLocalMobile(rawValue) {
  if (!rawValue) {
    return '';
  }
  const value = String(rawValue).replace(/\s+/g, '');
  if (value.startsWith('+966')) {
    return value.slice(4);
  }
  if (value.startsWith('966')) {
    return value.slice(3);
  }
  if (value.startsWith('05') && value.length === 10) {
    return value.slice(1);
  }
  return value;
}

function loadOrderTemplate() {
  if (!config.orderTemplatePath) {
    const localMobile = normalizeSallaLocalMobile(config.mobile);
    // Minimal order snapshot for customer lookup only.
    return {
      customer: {
        id: 332448390,
        mobile: Number(localMobile || config.mobile),
        mobile_code: config.mobileCode,
        email: config.email,
      },
    };
  }

  try {
    const fullPath = path.resolve(config.orderTemplatePath);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.data || parsed;
  } catch (err) {
    console.error('[mock-salla] Failed to load order template:', err.message);
    const localMobile = normalizeSallaLocalMobile(config.mobile);
    return {
      customer: {
        id: 332448390,
        mobile: Number(localMobile || config.mobile),
        mobile_code: config.mobileCode,
        email: config.email,
      },
    };
  }
}

let defaultOrderTemplate = loadOrderTemplate();

function loadOrderItemsTemplate() {
  // Minimal order items payload that matches the real Salla response structure.
  return [
    {
      id: 265026835,
      name: 'techrar 3 SAR',
      sku: '',
      quantity: 1,
      currency: 'SAR',
      amounts: {
        price_without_tax: { amount: 2.62, currency: 'SAR' },
        total: { amount: 3.01, currency: 'SAR' },
      },
      product: {
        id: 1497732785,
        name: 'techrar 3 SAR',
        sku: '',
        price: { amount: 2.62, currency: 'SAR' },
      },
      product_id: 1497732785,
    },
  ];
}

let defaultOrderItems = loadOrderItemsTemplate();

function requireAuth(req, res, next) {
  if (!config.requireAuth) {
    return next();
  }
  const auth = req.get('Authorization');
  if (!auth) {
    return res.status(401).json({ error: 'missing_authorization' });
  }
  if (config.expectedAuthToken && auth !== config.expectedAuthToken) {
    return res.status(401).json({ error: 'invalid_authorization' });
  }
  return next();
}

async function sendWebhook(url, token, payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = token;
  }
  try {
    const res = await axios.post(url, payload, {
      headers,
      timeout: config.webhookTimeoutMs,
    });
    return { status: res.status, data: res.data };
  } catch (err) {
    if (err.response) {
      return { status: err.response.status, data: err.response.data };
    }
    return { status: 0, data: err.message };
  }
}

function buildCorePayload(event, overrides) {
  const data = overrides || {};
  const merchantId = data.merchant_id || config.merchantId;
  const payload = {
    event,
    merchant: String(merchantId),
  };

  if (event === 'app.installed') {
    payload.data = {
      app_id: data.salla_app_id || process.env.SALLA_APP_ID || '0',
      installed_at: nowIso(),
    };
  } else if (event === 'app.store.authorize') {
    payload.data = {
      access_token: data.access_token || 'mock_access_token',
      refresh_token: data.refresh_token || 'mock_refresh_token',
      expires: data.expires || Math.floor(Date.now() / 1000) + 3600,
      scope: data.scope || config.scope,
      token_type: 'Bearer',
    };
  } else if (event === 'app.uninstalled') {
    payload.data = {
      uninstalled_at: nowIso(),
      reason: data.reason || 'testing',
    };
  }

  return payload;
}

function buildOrderPayload(event, overrides) {
  const data = overrides || {};
  const merchantId = data.merchant_id || config.merchantId;
  const appId = data.app_id || 1234567890;
  const subscriptionId = data.subscription_id || 687128419;
  const referenceOrderId = data.reference_order_id || data.order_id || 1754307967;
  const customerId = data.customer_id || 332448390;
  const intervalUnit = data.interval_unit || 'week';
  const intervalCount = data.interval_count || 1;
  const amount = data.amount || 3.01;
  const currency = data.currency || 'SAR';

  const payload = {
    event,
    merchant: String(merchantId),
    data: {},
  };

  if (event === 'subscription.created') {
    // Mirror the real webhook shape for repeatable tests.
    payload.created_at = data.webhook_created_at || 'Wed Jan 14 2026 11:27:32 GMT+0300';
    payload.data = {
      id: subscriptionId,
      total: {
        amount,
        currency,
      },
      reference: {
        id: referenceOrderId,
        customer: customerId,
      },
      meta: {
        techrar_id: appId,
      },
      slug: data.slug || 'techrar-weekly',
      app_id: data.salla_app_id || 61340169,
      interval_unit: intervalUnit,
      interval_count: intervalCount,
      // Keep a stable timestamp for deterministic tests.
      created_at: data.created_at || '2026-01-14T11:27:20+03:00',
    };
  } else if (event === 'subscription.charge.succeeded') {
    payload.data = {
      id: subscriptionId,
      subscription_id: subscriptionId,
      order_id: referenceOrderId,
      reference: { id: referenceOrderId },
      status: 'captured',
      charge_at: data.charge_at || nowIso(),
      created_at: nowIso(),
    };
  } else if (event === 'subscription.charge.failed') {
    payload.data = {
      id: subscriptionId,
      subscription_id: subscriptionId,
      order_id: referenceOrderId,
      reference: { id: referenceOrderId },
      status: 'failed',
      message: data.error_message || 'Charge failed',
      charge_at: data.charge_at || nowIso(),
      created_at: nowIso(),
    };
  } else if (event === 'subscription.cancelled') {
    payload.data = {
      id: subscriptionId,
      cancelled_at: nowIso(),
    };
  }

  return payload;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: nowIso() });
});

// Accounts API
app.get('/oauth2/user/info', requireAuth, (req, res) => {
  res.json({
    data: {
      name: config.userName,
      mobile: config.mobile,
      email: config.email,
      merchant: {
        id: config.merchantId,
        name: config.merchantName,
      },
    },
  });
});

app.post('/oauth2/token', (req, res) => {
  const refreshToken = req.body.refresh_token || 'mock_refresh_token';
  res.json({
    data: {
      access_token: `mock_access_${refreshToken}`,
      refresh_token: refreshToken,
      expires_in: 3600,
      expires: Math.floor(Date.now() / 1000) + 3600,
      scope: config.scope,
      token_type: 'Bearer',
    },
  });
});

app.get('/admin/v2/orders/items', requireAuth, (req, res) => {
  const orderId = req.query.order_id;
  if (!orderId) {
    return res.status(400).json({
      status: 400,
      success: false,
      error: { code: 'error', message: 'order_id is required' },
    });
  }
  const stored = state.orderItems.get(String(orderId));
  const items = stored ? deepClone(stored) : deepClone(defaultOrderItems);
  res.json({ status: 200, success: true, data: items });
});

// Admin API
app.get('/admin/v2/orders/:id', requireAuth, (req, res) => {
  const orderId = req.params.id;
  const stored = state.orders.get(orderId);
  const base = stored ? deepClone(stored) : deepClone(defaultOrderTemplate);
  base.id = orderId;
  res.json({ status: 200, success: true, data: base });
});

app.get('/admin/v2/products/:id', requireAuth, (req, res) => {
  const productId = req.params.id;
  res.json({
    data: {
      id: Number(productId),
      name: `Mock Product ${productId}`,
      sku: `mock_sku_${productId}`,
      price: { amount: 120.0, currency: 'SAR' },
    },
  });
});

app.post('/admin/v2/apps/:id/settings', requireAuth, (req, res) => {
  res.json({
    success: true,
    app_id: req.params.id,
    data: req.body || {},
  });
});

app.put('/admin/v2/settings/fields/enable_recurring_payment', requireAuth, (req, res) => {
  res.json({
    success: true,
    value: req.body ? req.body.value : true,
  });
});

app.post('/admin/v2/webhooks/subscribe', requireAuth, (req, res) => {
  const subscription = {
    id: `wh_${Date.now()}`,
    created_at: nowIso(),
    ...req.body,
  };
  state.webhooks.push(subscription);
  res.status(201).json({ data: subscription });
});

app.post('/admin/v2/subscriptions/:id/charge', requireAuth, async (req, res) => {
  const subscriptionId = req.params.id;
  const charge = {
    id: `charge_${Date.now()}`,
    subscription_id: subscriptionId,
    created_at: nowIso(),
  };
  state.charges.push(charge);

  const renewalOrderId = req.body && req.body.order_id ? req.body.order_id : `order_${Date.now()}`;
  const event = config.sendChargeSucceeded ? 'subscription.charge.succeeded' : 'subscription.charge.failed';
  const payload = buildOrderPayload(event, {
    subscription_id: subscriptionId,
    reference_order_id: renewalOrderId,
  });
  console.log(`[mock-salla] charge webhook dispatch: event=${event} subscription_id=${subscriptionId} order_id=${renewalOrderId}`);
  await sendWebhook(config.orderWebhookUrl, config.webhookToken, payload);

  res.json({ success: true, data: charge });
});

app.delete('/admin/v2/subscriptions/:id', requireAuth, async (req, res) => {
  const subscriptionId = req.params.id;
  const existing = state.cancellations.get(subscriptionId);
  const cancellation = existing || {
    id: subscriptionId,
    cancelled_at: nowIso(),
  };
  state.cancellations.set(subscriptionId, cancellation);

  if (config.autoCancelWebhook) {
    const payload = buildOrderPayload('subscription.cancelled', {
      subscription_id: subscriptionId,
      merchant_id: config.merchantId,
    });
    await sendWebhook(config.orderWebhookUrl, config.webhookToken, payload);
  }

  res.json({ success: true, data: cancellation });
});

// Mock management endpoints
app.get('/mock/webhooks', (req, res) => {
  res.json({ data: state.webhooks });
});

app.get('/mock/orders/:id', (req, res) => {
  const stored = state.orders.get(req.params.id);
  res.json({ data: stored || null });
});

app.post('/mock/orders/:id', (req, res) => {
  const body = req.body || {};
  state.orders.set(req.params.id, body);
  res.json({ success: true });
});

app.get('/mock/orders/:id/items', (req, res) => {
  const stored = state.orderItems.get(req.params.id);
  res.json({ data: stored || null });
});

app.post('/mock/orders/:id/items', (req, res) => {
  const body = req.body || {};
  const items = body.data || body.items || body;
  state.orderItems.set(req.params.id, items);
  res.json({ success: true });
});

app.get('/mock/subscriptions/:id/cancel', (req, res) => {
  const stored = state.cancellations.get(req.params.id);
  res.json({ data: stored || null });
});

app.post('/mock/webhook', async (req, res) => {
  const { target, event, payload, overrides, token, url, dry_run } = req.body || {};
  if (!target || !event) {
    return res.status(400).json({ error: 'target and event are required' });
  }
  const targetUrl = url || (target === 'core' ? config.coreWebhookUrl : config.orderWebhookUrl);
  const authToken = token || config.webhookToken;
  const body = payload || (target === 'core' ? buildCorePayload(event, overrides) : buildOrderPayload(event, overrides));

  if (dry_run) {
    console.log(`[mock-salla] dry-run webhook: target=${target} event=${event} url=${targetUrl}`);
    return res.json({ request: body, target_url: targetUrl, dry_run: true });
  }

  console.log(`[mock-salla] webhook dispatch: target=${target} event=${event} url=${targetUrl}`);
  const result = await sendWebhook(targetUrl, authToken, body);
  console.log(`[mock-salla] webhook response: status=${result.status}`);
  res.json({ request: body, response: result });
});

app.post('/mock/scenario', async (req, res) => {
  const opts = req.body || {};
  const merchantId = opts.merchant_id || config.merchantId;
  const appId = opts.app_id || Number(process.env.TECHRAR_APP_ID || 0);
  const referenceOrderId = opts.reference_order_id || `order_${Date.now()}`;
  const subscriptionId = opts.subscription_id || `sub_${Date.now()}`;
  const delayMs = Number(opts.sleep_ms || 0);
  const renewals = Number(opts.renewals || 1);
  const orderIdStrategy = opts.order_id_strategy || 'same';
  const renewalOrderIds = Array.isArray(opts.renewal_order_ids) ? opts.renewal_order_ids : null;
  const failThenSuccess = Boolean(opts.fail_then_success);
  const failedOnly = Boolean(opts.failed_only);
  const successOnly = Boolean(opts.success_only);
  const results = [];

  const steps = [];

  steps.push({
    target: 'core',
    event: 'app.installed',
    overrides: { merchant_id: merchantId },
  });

  if (!opts.skip_authorize) {
    steps.push({
      target: 'core',
      event: 'app.store.authorize',
      overrides: {
        merchant_id: merchantId,
        access_token: opts.access_token || 'mock_access_token',
        refresh_token: opts.refresh_token || 'mock_refresh_token',
      },
    });
  }

  steps.push({
    target: 'order',
    event: 'subscription.created',
    overrides: {
      merchant_id: merchantId,
      app_id: appId,
      subscription_id: subscriptionId,
      reference_order_id: referenceOrderId,
    },
  });

  const buildRenewalOrderId = (index) => {
    if (renewalOrderIds && renewalOrderIds[index]) {
      return renewalOrderIds[index];
    }
    if (orderIdStrategy === 'sequence') {
      return `${referenceOrderId}-${index + 1}`;
    }
    if (orderIdStrategy === 'timestamp') {
      return `order_${Date.now()}_${index + 1}`;
    }
    return referenceOrderId;
  };

  for (let i = 0; i < renewals; i += 1) {
    const renewalOrderId = buildRenewalOrderId(i);

    // Optional: emit a failure before success for the first renewal to test idempotency.
    if (failThenSuccess && i === 0 && !failedOnly && !successOnly) {
      steps.push({
        target: 'order',
        event: 'subscription.charge.failed',
        overrides: {
          merchant_id: merchantId,
          subscription_id: subscriptionId,
          reference_order_id: renewalOrderId,
          error_message: opts.error_message || 'Charge failed',
        },
      });
    }

    if (!failedOnly) {
      steps.push({
        target: 'order',
        event: 'subscription.charge.succeeded',
        overrides: {
          merchant_id: merchantId,
          subscription_id: subscriptionId,
          reference_order_id: renewalOrderId,
        },
      });
    }

    if (!successOnly) {
      if (opts.include_failed || failedOnly) {
        steps.push({
          target: 'order',
          event: 'subscription.charge.failed',
          overrides: {
            merchant_id: merchantId,
            subscription_id: subscriptionId,
            reference_order_id: renewalOrderId,
            error_message: opts.error_message || 'Charge failed',
          },
        });
      }
    }
  }

  if (opts.include_cancel) {
    steps.push({
      target: 'order',
      event: 'subscription.cancelled',
      overrides: {
        merchant_id: merchantId,
        subscription_id: subscriptionId,
      },
    });
  }

  if (opts.include_uninstall) {
    steps.push({
      target: 'core',
      event: 'app.uninstalled',
      overrides: { merchant_id: merchantId },
    });
  }

  for (const step of steps) {
    const targetUrl = step.target === 'core' ? config.coreWebhookUrl : config.orderWebhookUrl;
    const body = step.target === 'core'
      ? buildCorePayload(step.event, step.overrides)
      : buildOrderPayload(step.event, step.overrides);
    const result = await sendWebhook(targetUrl, config.webhookToken, body);
    results.push({
      step: step.event,
      target: step.target,
      request: body,
      response: result,
    });
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  res.json({ results });
});

app.listen(config.port, () => {
  console.log(`[mock-salla] listening on http://localhost:${config.port}`);
  console.log(`[mock-salla] core webhook: ${config.coreWebhookUrl}`);
  console.log(`[mock-salla] order webhook: ${config.orderWebhookUrl}`);
});
