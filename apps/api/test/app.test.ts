import { describe, expect, it } from 'vitest';

import { canonicalJson, signPartnerRequest } from '@trinetra/security';

import { buildApp } from '../src/app.js';

const partnerSecret = 'foundation-demo-secret-at-least-32-characters';
const fixedNow = new Date('2026-08-10T12:00:00.000Z');

const trustedIntent = {
  partner_customer_ref: 'cust_demo_104',
  direction: 'PUSH',
  payment_type: 'P2M',
  amount_paise: 24_900,
  currency: 'INR',
  beneficiary: { vpa_token: 'vpa_tok_trusted_merchant', resolved_name: 'Aarav Electronics' },
  merchant: { merchant_ref: 'm_demo_12', expected_name: 'Aarav Electronics', mcc: '5732' },
  context: {
    channel: 'UPI_INTENT',
    device_token: 'dev_tok_trusted',
    session_ref: 'sess_demo_01',
    user_claimed_goal: 'PAY_MERCHANT',
    remote_access_active: false,
  },
} as const;

function signedHeaders(body: object, nonce: string, idempotencyKey = 'idem_demo_001') {
  const timestamp = String(Math.floor(fixedNow.getTime() / 1000));
  const canonicalBody = canonicalJson(body);
  return {
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey,
    'x-partner-key': 'partner_demo',
    'x-timestamp': timestamp,
    'x-nonce': nonce,
    'x-signature': signPartnerRequest(partnerSecret, {
      method: 'POST',
      path: '/v1/payment-intents',
      timestamp,
      nonce,
      body: canonicalBody,
    }),
  };
}

describe('TRINETRA partner API foundation', () => {
  it('keeps liveness separate from partner authentication', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
    });

    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'trinetra-api' });
    await app.close();
  });

  it('rejects unsigned payment intent writes', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      payload: trustedIntent,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
    await app.close();
  });

  it('returns an explainable ALLOW for the signed ₹249 trusted merchant intent', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: signedHeaders(trustedIntent, 'nonce_allow_001'),
      payload: trustedIntent,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      decision: 'ALLOW',
      risk_score: 8,
      subscores: { identity: 8, intent: 6, integrity: 4 },
      rule_set_version: 'ruleset_foundation_1',
    });
    await app.close();
  });

  it('replays the same idempotent result but rejects a changed body', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
    });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: signedHeaders(trustedIntent, 'nonce_idem_001'),
      payload: trustedIntent,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: signedHeaders(trustedIntent, 'nonce_idem_002'),
      payload: trustedIntent,
    });
    const changedIntent = { ...trustedIntent, amount_paise: 25_000 };
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: signedHeaders(changedIntent, 'nonce_idem_003'),
      payload: changedIntent,
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().payment_intent_id).toBe(first.json().payment_intent_id);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    await app.close();
  });
});
