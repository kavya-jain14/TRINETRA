import { describe, expect, it } from 'vitest';

import { InMemoryCaseRepository } from '@trinetra/case-core';
import { apiEnvSchema } from '@trinetra/config';
import { canonicalJson, signPartnerRequest } from '@trinetra/security';
import {
  DeterministicPaymentProviderAdapter,
  InMemoryPaymentLedgerRepository,
} from '@trinetra/payment-core';

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

function signedHeaders(
  body: object,
  nonce: string,
  idempotencyKey = 'idem_demo_001',
  path = '/v1/payment-intents',
) {
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
      path,
      timestamp,
      nonce,
      body: canonicalBody,
    }),
  };
}

function providerHeaders(body: object, nonce: string) {
  const timestamp = String(Math.floor(fixedNow.getTime() / 1000));
  return {
    'content-type': 'application/json',
    'x-timestamp': timestamp,
    'x-nonce': nonce,
    'x-signature': signPartnerRequest(partnerSecret, {
      method: 'POST',
      path: '/v1/provider-events/trinetra-sandbox',
      timestamp,
      nonce,
      body: canonicalJson(body),
    }),
  };
}

describe('TRINETRA partner API foundation', () => {
  it('rejects demo orchestration in production configuration', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://trinetra:secret@localhost:5432/trinetra',
      REDIS_URL: 'redis://localhost:6379',
      DEMO_PARTNER_SECRET: partnerSecret,
    };

    expect(
      apiEnvSchema.safeParse({ ...baseEnv, NODE_ENV: 'production', DEMO_MODE: 'true' }).success,
    ).toBe(false);
    expect(
      apiEnvSchema.parse({ ...baseEnv, NODE_ENV: 'development', DEMO_MODE: 'true' }).DEMO_MODE,
    ).toBe(true);
  });

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

  it('fails readiness when a required dependency is unavailable', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
      readinessChecks: {
        postgresql: async () => {
          throw new Error('synthetic database outage');
        },
      },
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'not_ready',
      service: 'trinetra-api',
      dependencies: { postgresql: 'unavailable' },
    });
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

  it('opens one durable case for a signed BLOCK assessment and replays it idempotently', async () => {
    const caseRepository = new InMemoryCaseRepository();
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
      caseRepository,
    });
    const blockedIntent = {
      ...trustedIntent,
      direction: 'COLLECT',
      payment_type: 'P2P',
      merchant: undefined,
      context: {
        ...trustedIntent.context,
        channel: 'UPI_COLLECT',
        user_claimed_goal: 'RECEIVE_REFUND',
        remote_access_active: true,
      },
    } as const;

    const created = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: signedHeaders(blockedIntent, 'nonce_signed_block_001', 'idem_signed_block_001'),
      payload: blockedIntent,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: signedHeaders(blockedIntent, 'nonce_signed_block_002', 'idem_signed_block_001'),
      payload: blockedIntent,
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      decision: 'BLOCK',
      required_action: { type: 'STOP_PAYMENT' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().case_id).toBe(created.json().case_id);
    expect(await caseRepository.listCases('00000000-0000-4000-8000-000000000001', 10)).toEqual([
      expect.objectContaining({
        id: created.json().case_id,
        paymentId: created.json().payment_intent_id,
        status: 'OPEN',
      }),
    ]);
    await app.close();
  });

  it('does not grant device trust from a misleading token substring', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
    });
    const misleadingIntent = {
      ...trustedIntent,
      context: { ...trustedIntent.context, device_token: 'dev_tok_untrusted' },
    } as const;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: signedHeaders(misleadingIntent, 'nonce_untrusted_001', 'idem_untrusted_001'),
      payload: misleadingIntent,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      decision: 'WARN',
      subscores: { identity: 48 },
      reasons: [expect.objectContaining({ code: 'UNKNOWN_DEVICE' })],
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

  it('stores a privacy-minimized payment request without cleartext names', async () => {
    const repository = new InMemoryPaymentLedgerRepository();
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
      ledgerRepository: repository,
    });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: signedHeaders(trustedIntent, 'nonce_privacy_001', 'idem_privacy_001'),
      payload: trustedIntent,
    });
    const payment = await repository.getPayment(
      '00000000-0000-4000-8000-000000000001',
      created.json().payment_intent_id,
    );
    const stored = JSON.stringify(payment?.requestBody);

    expect(stored).not.toContain('Aarav Electronics');
    expect(payment?.requestBody).toMatchObject({
      beneficiary: { vpa_token: 'vpa_tok_trusted_merchant' },
      merchant: { merchant_ref: 'm_demo_12', mcc: '5732' },
    });
    expect(payment?.requestBody).toMatchObject({
      merchant: { payee_name_matches_merchant: true },
    });
    await app.close();
  });

  it('returns NOT_FOUND instead of INTERNAL_ERROR for an unknown payment submit', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
    });
    const body = { scenario: 'SUCCESS_IMMEDIATE' } as const;
    const path = '/v1/payment-intents/pi_missing_001/submit';
    const response = await app.inject({
      method: 'POST',
      url: path,
      headers: signedHeaders(body, 'nonce_missing_001', 'idem_missing_001', path),
      payload: body,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
    await app.close();
  });

  it('submits once, recovers through an authenticated callback, and ignores stale events', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
    });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: signedHeaders(trustedIntent, 'nonce_flow_create', 'idem_flow_001'),
      payload: trustedIntent,
    });
    const paymentId = created.json().payment_intent_id as string;
    const submitBody = { scenario: 'PENDING_THEN_SUCCESS' } as const;
    const submitPath = `/v1/payment-intents/${paymentId}/submit`;
    const submitted = await app.inject({
      method: 'POST',
      url: submitPath,
      headers: signedHeaders(submitBody, 'nonce_flow_submit', 'idem_submit_001', submitPath),
      payload: submitBody,
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json().payment.state).toBe('PENDING');

    const changedSubmission = { scenario: 'SUCCESS_IMMEDIATE' } as const;
    const conflict = await app.inject({
      method: 'POST',
      url: submitPath,
      headers: signedHeaders(
        changedSubmission,
        'nonce_flow_submit_conflict',
        'idem_submit_001',
        submitPath,
      ),
      payload: changedSubmission,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');

    const callback = {
      event_id: 'pe_api_success_001',
      payment_id: paymentId,
      provider_ref: `psp_${paymentId.slice(3)}`,
      status: 'SUCCEEDED',
      amount_paise: trustedIntent.amount_paise,
      occurred_at: fixedNow.toISOString(),
    } as const;
    const wrongReference = { ...callback, event_id: 'pe_api_wrong_ref', provider_ref: 'psp_wrong' };
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/provider-events/trinetra-sandbox',
      headers: providerHeaders(wrongReference, 'nonce_callback_wrong_ref'),
      payload: wrongReference,
    });
    const applied = await app.inject({
      method: 'POST',
      url: '/v1/provider-events/trinetra-sandbox',
      headers: providerHeaders(callback, 'nonce_callback_001'),
      payload: callback,
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/provider-events/trinetra-sandbox',
      headers: providerHeaders(callback, 'nonce_callback_002'),
      payload: callback,
    });
    const stale = { ...callback, event_id: 'pe_api_stale_001', status: 'PENDING' } as const;
    const ignored = await app.inject({
      method: 'POST',
      url: '/v1/provider-events/trinetra-sandbox',
      headers: providerHeaders(stale, 'nonce_callback_003'),
      payload: stale,
    });

    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe('VALIDATION_FAILED');
    expect(applied.statusCode).toBe(202);
    expect(applied.json()).toMatchObject({ outcome: 'APPLIED', payment: { state: 'SUCCEEDED' } });
    expect(duplicate.json().outcome).toBe('DUPLICATE');
    expect(ignored.json()).toMatchObject({
      outcome: 'IGNORED_STALE',
      payment: { state: 'SUCCEEDED' },
    });
    await app.close();
  });

  it('rejects an unauthenticated provider callback', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/provider-events/trinetra-sandbox',
      payload: {
        event_id: 'pe_unsigned_001',
        payment_id: 'pi_unknown_001',
        provider_ref: 'psp_unknown_001',
        status: 'PENDING',
        amount_paise: 24_900,
        occurred_at: fixedNow.toISOString(),
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
    await app.close();
  });

  it('does not register browser demo orchestration unless demo mode is explicit', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/trusted-payment/run',
      payload: { run_id: 'run_disabled01' },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('runs and replays the live trusted-payment demo without exposing partner secrets', async () => {
    const repository = new InMemoryPaymentLedgerRepository();
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
      ledgerRepository: repository,
      demoMode: true,
    });
    const payload = { run_id: 'run_golden001' };

    const created = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/trusted-payment/run',
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/trusted-payment/run',
      payload,
    });
    const listed = await app.inject({ method: 'GET', url: '/v1/demo/payments?limit=8' });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      scenario: { key: 'trusted-payment', amount_paise: 24_900 },
      assessment: {
        decision: 'ALLOW',
        risk_score: 8,
        subscores: { identity: 8, intent: 6, integrity: 4 },
      },
      payment: { state: 'SUCCEEDED' },
      provider_attempts: [
        {
          operation: 'SUBMIT',
          status: 'COMPLETED',
          provider_status: 'SUCCEEDED',
        },
      ],
    });
    expect(created.json().timeline.map((event: { to_state: string }) => event.to_state)).toEqual([
      'CREATED',
      'RISK_EVALUATING',
      'ALLOWED',
      'SUBMITTED',
      'SUCCEEDED',
    ]);
    expect(JSON.stringify(created.json())).not.toContain(partnerSecret);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().payment.payment_intent_id).toBe(created.json().payment.payment_intent_id);
    expect(replay.json().provider_attempts).toHaveLength(1);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().payments).toHaveLength(1);
    await app.close();
  });

  it('recovers an accepted timeout without creating a second provider submission', async () => {
    const repository = new InMemoryPaymentLedgerRepository();
    const provider = new DeterministicPaymentProviderAdapter();
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
      ledgerRepository: repository,
      paymentProvider: provider,
      demoMode: true,
    });
    const payload = { run_id: 'run_timeout001' };

    const created = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/timeout-recovery/run',
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/timeout-recovery/run',
      payload,
    });
    const recovered = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/timeout-recovery/recover',
      payload,
    });
    const recoveredReplay = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/timeout-recovery/recover',
      payload,
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      scenario: { key: 'timeout-recovery', amount_paise: 78_600 },
      assessment: { decision: 'ALLOW' },
      payment: { state: 'PENDING' },
      provider_attempts: [
        {
          operation: 'SUBMIT',
          status: 'UNKNOWN',
          provider_status: 'PENDING',
          response_code: 'TIMEOUT_UNKNOWN',
        },
      ],
      recovery: {
        resolved_at: null,
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().payment.payment_intent_id).toBe(created.json().payment.payment_intent_id);
    expect(replay.json().provider_attempts).toHaveLength(1);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().payment.state).toBe('SUCCEEDED');
    expect(recovered.json().provider_attempts).toMatchObject([
      { operation: 'SUBMIT', status: 'UNKNOWN' },
      { operation: 'STATUS_INQUIRY', status: 'COMPLETED', provider_status: 'SUCCEEDED' },
    ]);
    expect(recovered.json().timeline.map((event: { to_state: string }) => event.to_state)).toEqual([
      'CREATED',
      'RISK_EVALUATING',
      'ALLOWED',
      'SUBMITTED',
      'PENDING',
      'SUCCEEDED',
    ]);
    expect(recovered.json().recovery).toMatchObject({
      status_check_due_at: null,
      resolved_at: fixedNow.toISOString(),
    });
    expect(recoveredReplay.statusCode).toBe(200);
    expect(recoveredReplay.json().provider_attempts).toHaveLength(2);
    expect(provider.submissionCount).toBe(1);
    expect(provider.inquiryCount).toBe(1);
    await app.close();
  });

  it('tracks a missing merchant confirmation through reversal without a second debit', async () => {
    const repository = new InMemoryPaymentLedgerRepository();
    const provider = new DeterministicPaymentProviderAdapter();
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
      ledgerRepository: repository,
      paymentProvider: provider,
      demoMode: true,
    });
    const payload = { run_id: 'run_reversal001' };

    const pending = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/reversal-recovery/run',
      payload,
    });
    const reversalPending = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/reversal-recovery/recover',
      payload,
    });
    const reversed = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/reversal-recovery/recover',
      payload,
    });
    const terminalReplay = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/reversal-recovery/recover',
      payload,
    });

    expect(pending.statusCode).toBe(201);
    expect(pending.json()).toMatchObject({
      scenario: { key: 'reversal-recovery', amount_paise: 42_500 },
      assessment: { decision: 'ALLOW' },
      payment: { state: 'PENDING' },
      provider_attempts: [{ operation: 'SUBMIT', status: 'COMPLETED', provider_status: 'PENDING' }],
    });
    expect(reversalPending.statusCode).toBe(200);
    expect(reversalPending.json()).toMatchObject({
      payment: { state: 'REVERSAL_PENDING' },
      recovery: {
        reversal_due_at: '2026-08-10T12:00:30.000Z',
        complaint_eligible_at: '2026-08-10T12:02:00.000Z',
        resolved_at: null,
      },
    });
    expect(reversed.statusCode).toBe(200);
    expect(reversed.json().payment.state).toBe('REVERSED');
    expect(reversed.json().timeline.map((event: { to_state: string }) => event.to_state)).toEqual([
      'CREATED',
      'RISK_EVALUATING',
      'ALLOWED',
      'SUBMITTED',
      'PENDING',
      'REVERSAL_PENDING',
      'REVERSED',
    ]);
    expect(
      reversed
        .json()
        .provider_attempts.map((attempt: { operation: string; provider_status: string | null }) => [
          attempt.operation,
          attempt.provider_status,
        ]),
    ).toEqual([
      ['SUBMIT', 'PENDING'],
      ['STATUS_INQUIRY', 'REVERSAL_PENDING'],
      ['STATUS_INQUIRY', 'REVERSED'],
    ]);
    expect(reversed.json().recovery.resolved_at).toBe(fixedNow.toISOString());
    expect(terminalReplay.statusCode).toBe(200);
    expect(terminalReplay.json().provider_attempts).toHaveLength(3);
    expect(provider.submissionCount).toBe(1);
    expect(provider.inquiryCount).toBe(2);
    await app.close();
  });

  it('blocks the deceptive refund collect flow, opens one case, and never calls the provider', async () => {
    const repository = new InMemoryPaymentLedgerRepository();
    const caseRepository = new InMemoryCaseRepository();
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
      ledgerRepository: repository,
      caseRepository,
      demoMode: true,
    });
    const payload = { run_id: 'run_refund001' };

    const created = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/refund-collect/run',
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/refund-collect/run',
      payload,
    });
    const cases = await app.inject({ method: 'GET', url: '/v1/demo/cases?limit=8' });
    const paymentId = created.json().payment.payment_intent_id as string;
    const submitBody = { scenario: 'SUCCESS_IMMEDIATE' } as const;
    const submitPath = `/v1/payment-intents/${paymentId}/submit`;
    const forbiddenSubmit = await app.inject({
      method: 'POST',
      url: submitPath,
      headers: signedHeaders(
        submitBody,
        'nonce_blocked_submit_001',
        'idem_blocked_submit_001',
        submitPath,
      ),
      payload: submitBody,
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      scenario: { key: 'refund-collect', amount_paise: 199_900, direction: 'COLLECT' },
      assessment: {
        decision: 'BLOCK',
        risk_score: 98,
        required_action: { type: 'STOP_PAYMENT' },
        reasons: [
          expect.objectContaining({ code: 'REMOTE_ACCESS_ACTIVE' }),
          expect.objectContaining({ code: 'REFUND_COLLECT_CONFLICT' }),
          expect.objectContaining({ code: 'NEW_BENEFICIARY' }),
        ],
      },
      payment: { state: 'BLOCKED', provider_request_ref: null },
      provider_attempts: [],
      fraud_case: {
        status: 'OPEN',
        severity: 'CRITICAL',
        category: 'SOCIAL_ENGINEERING',
        evidence: [
          expect.objectContaining({ code: 'REMOTE_ACCESS_ACTIVE', lens: 'INTEGRITY' }),
          expect.objectContaining({ code: 'REFUND_COLLECT_CONFLICT', lens: 'INTENT' }),
          expect.objectContaining({ code: 'NEW_BENEFICIARY', lens: 'INTENT' }),
        ],
      },
    });
    expect(created.json().timeline.map((event: { to_state: string }) => event.to_state)).toEqual([
      'CREATED',
      'RISK_EVALUATING',
      'BLOCKED',
    ]);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().fraud_case.case_id).toBe(created.json().fraud_case.case_id);
    expect(cases.statusCode).toBe(200);
    expect(cases.json().cases).toHaveLength(1);
    expect(forbiddenSubmit.statusCode).toBe(409);
    expect(forbiddenSubmit.json().error.code).toBe('ILLEGAL_STATE_TRANSITION');
    expect(
      await repository.listProviderAttempts('00000000-0000-4000-8000-000000000001', paymentId),
    ).toEqual([]);
    expect(
      JSON.stringify(
        await repository.getPayment('00000000-0000-4000-8000-000000000001', paymentId),
      ),
    ).not.toContain('Synthetic Refund Desk');
    await app.close();
  });

  it('blocks a two-hop graph-linked destination with explainable bounded evidence', async () => {
    const repository = new InMemoryPaymentLedgerRepository();
    const caseRepository = new InMemoryCaseRepository();
    const provider = new DeterministicPaymentProviderAdapter();
    let currentNow = fixedNow;
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => currentNow,
      ledgerRepository: repository,
      caseRepository,
      paymentProvider: provider,
      demoMode: true,
    });
    const payload = { run_id: 'run_graph001' };

    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/mule-network/run',
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/mule-network/run',
      payload,
    });

    expect(blocked.statusCode).toBe(201);
    expect(blocked.json()).toMatchObject({
      scenario: { key: 'mule-network', amount_paise: 64_900 },
      assessment: {
        decision: 'BLOCK',
        risk_score: 92,
        subscores: { identity: 8, intent: 6, integrity: 92 },
        reasons: [{ code: 'GRAPH_LINKED_DESTINATION', impact: 75 }],
      },
      payment: { state: 'BLOCKED', provider_request_ref: null },
      provider_attempts: [],
      graph: {
        linked_confirmed_cases: 2,
        minimum_hops: 2,
        risk_contribution: 75,
        max_hops: 2,
        truncated: false,
      },
      fraud_case: {
        status: 'OPEN',
        severity: 'HIGH',
        category: 'RISK_REVIEW',
        summary: 'Graph-linked destination blocked for bounded analyst review.',
        evidence: [{ code: 'GRAPH_LINKED_DESTINATION', lens: 'INTEGRITY' }],
      },
    });
    expect(blocked.json().graph.nodes).toHaveLength(6);
    expect(blocked.json().graph.edges).toHaveLength(5);
    expect(blocked.json().timeline.at(-1).evidence.graph).toMatchObject({
      destination_ref: 'vpa_tok_graph_destination_47',
      linked_confirmed_cases: 2,
      minimum_hops: 2,
    });
    expect(blocked.json().timeline.map((event: { to_state: string }) => event.to_state)).toEqual([
      'CREATED',
      'RISK_EVALUATING',
      'BLOCKED',
    ]);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().payment.payment_intent_id).toBe(blocked.json().payment.payment_intent_id);
    expect(replay.json().fraud_case.case_id).toBe(blocked.json().fraud_case.case_id);
    currentNow = new Date('2026-11-15T12:00:00.000Z');
    const historical = await app.inject({
      method: 'GET',
      url: `/v1/demo/payments/${blocked.json().payment.payment_intent_id}`,
    });
    expect(historical.json().graph).toEqual(blocked.json().graph);
    expect(provider.submissionCount).toBe(0);
    await app.close();
  });

  it('rejects malformed demo identifiers and hides non-demo payments from demo reads', async () => {
    const app = await buildApp({
      partnerKey: 'partner_demo',
      partnerSecret,
      now: () => fixedNow,
      demoMode: true,
    });

    const invalidRun = await app.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/trusted-payment/run',
      payload: { run_id: '../unsafe' },
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/demo/payments/pi_demo_12345678',
    });

    expect(invalidRun.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
