import { describe, expect, it } from 'vitest';

import type { PaymentIntentRequest } from '@trinetra/contracts';

import { evaluatePaymentIntent } from '../src/index.js';

const trustedIntent: PaymentIntentRequest = {
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
};

const context = {
  now: new Date('2026-08-10T12:00:00.000Z'),
  paymentIntentId: 'pi_foundation_demo',
  traceId: 'tr_foundation_demo',
  deviceTrust: 'TRUSTED' as const,
};

describe('three-eye deterministic evaluation', () => {
  it('allows the ₹249 trusted merchant fixture with three low scores', () => {
    const result = evaluatePaymentIntent(trustedIntent, context);

    expect(result.decision).toBe('ALLOW');
    expect(result.subscores).toEqual({ identity: 8, intent: 6, integrity: 4 });
    expect(result.risk_score).toBe(8);
    expect(result.reasons).toEqual([]);
  });

  it('blocks a deceptive refund collect request with a stable reason', () => {
    const result = evaluatePaymentIntent(
      {
        ...trustedIntent,
        direction: 'COLLECT',
        context: { ...trustedIntent.context, user_claimed_goal: 'RECEIVE_REFUND' },
      },
      { ...context, beneficiaryTrust: 'NEW' },
    );

    expect(result.decision).toBe('BLOCK');
    expect(result.reasons[0]?.code).toBe('REFUND_COLLECT_CONFLICT');
    expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'NEW_BENEFICIARY' }));
  });

  it('does not infer trust from a token containing the word trusted', () => {
    const result = evaluatePaymentIntent(
      {
        ...trustedIntent,
        context: { ...trustedIntent.context, device_token: 'dev_tok_untrusted' },
      },
      { ...context, deviceTrust: 'UNKNOWN' },
    );

    expect(result.subscores.identity).toBe(48);
    expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_DEVICE' }));
  });

  it('normalizes harmless whitespace and casing before comparing payee names', () => {
    const result = evaluatePaymentIntent(
      {
        ...trustedIntent,
        beneficiary: {
          ...trustedIntent.beneficiary,
          resolved_name: '  AARAV   electronics  ',
        },
      },
      context,
    );

    expect(result.subscores.integrity).toBe(4);
    expect(result.reasons).not.toContainEqual(
      expect.objectContaining({ code: 'PAYEE_MERCHANT_MISMATCH' }),
    );
    expect(result.decision).toBe('ALLOW');
  });

  it('uses bounded graph evidence instead of inferring risk from token text', () => {
    const textOnly = evaluatePaymentIntent(
      {
        ...trustedIntent,
        beneficiary: { ...trustedIntent.beneficiary, vpa_token: 'vpa_tok_mule_text_only' },
      },
      context,
    );
    const graphLinked = evaluatePaymentIntent(trustedIntent, {
      ...context,
      graphRisk: {
        linkedConfirmedCases: 2,
        minimumHops: 2,
        contribution: 75,
        truncated: false,
      },
    });

    expect(textOnly.reasons).not.toContainEqual(
      expect.objectContaining({ code: 'GRAPH_LINKED_DESTINATION' }),
    );
    expect(graphLinked).toMatchObject({
      decision: 'BLOCK',
      risk_score: 92,
      subscores: { integrity: 92 },
    });
    expect(graphLinked.reasons).toContainEqual({
      code: 'GRAPH_LINKED_DESTINATION',
      impact: 75,
      user_message: 'The destination is linked to a reported synthetic risk cluster.',
    });
  });

  it('steps up instead of silently allowing an incomplete bounded graph check', () => {
    const result = evaluatePaymentIntent(trustedIntent, {
      ...context,
      graphRisk: {
        linkedConfirmedCases: 0,
        minimumHops: null,
        contribution: 0,
        truncated: true,
      },
    });

    expect(result).toMatchObject({
      decision: 'STEP_UP',
      risk_score: 68,
      subscores: { integrity: 68 },
      reasons: [{ code: 'GRAPH_EVIDENCE_TRUNCATED', impact: 35 }],
    });
  });
});
