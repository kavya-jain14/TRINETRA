import { describe, expect, it } from 'vitest';

import {
  DemoPaymentSnapshotSchema,
  DemoRunRequestSchema,
  FraudCaseSnapshotSchema,
  PartnerWebhookEnvelopeSchema,
  PaymentIntentRequestSchema,
  PaymentSubmissionRequestSchema,
  ProviderCallbackSchema,
  ProviderScenarioSchema,
  RiskAssessmentSchema,
} from '../src/index.js';

describe('payment intent contracts', () => {
  it('rejects fractional paise', () => {
    const parsed = PaymentIntentRequestSchema.safeParse({
      partner_customer_ref: 'cust_demo_104',
      direction: 'PUSH',
      payment_type: 'P2M',
      amount_paise: 249.5,
      currency: 'INR',
      beneficiary: { vpa_token: 'vpa_tok_demo_merchant', resolved_name: 'Aarav Electronics' },
      context: {
        channel: 'UPI_INTENT',
        device_token: 'dev_tok_trusted',
        session_ref: 'sess_demo_01',
        user_claimed_goal: 'PAY_MERCHANT',
        remote_access_active: false,
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('requires every NETRA subscore in a decision', () => {
    const parsed = RiskAssessmentSchema.safeParse({
      payment_intent_id: 'pi_demo',
      decision: 'ALLOW',
      risk_score: 8,
      subscores: { identity: 8, intent: 6 },
      reasons: [],
      required_action: { type: 'NONE', expires_at: '2026-08-10T12:05:00.000Z' },
      rule_set_version: 'ruleset_foundation_1',
      case_id: null,
      trace_id: 'tr_demo',
      resource_version: 1,
    });

    expect(parsed.success).toBe(false);
  });

  it('defaults synthetic submission to the immediate success scenario', () => {
    expect(PaymentSubmissionRequestSchema.parse({})).toEqual({ scenario: 'SUCCESS_IMMEDIATE' });
    expect(ProviderScenarioSchema.parse('TIMEOUT_THEN_SUCCESS')).toBe('TIMEOUT_THEN_SUCCESS');
  });

  it('rejects provider callback states outside the published recovery contract', () => {
    const parsed = ProviderCallbackSchema.safeParse({
      event_id: 'pe_demo_001',
      payment_id: 'pi_demo_001',
      provider_ref: 'psp_demo_001',
      status: 'CREATED',
      amount_paise: 24_900,
      occurred_at: '2026-08-10T12:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('publishes a strict partner webhook envelope contract', () => {
    const envelope = PartnerWebhookEnvelopeSchema.parse({
      delivery_key: 'outbox-event-001',
      event_id: 'event-001',
      event_type: 'payment.state_changed',
      aggregate_id: 'pi_demo_001',
      payload: { payment_id: 'pi_demo_001', state: 'SUCCEEDED' },
      created_at: '2026-08-10T12:00:00.000Z',
    });

    expect(envelope.delivery_key).toBe('outbox-event-001');
    expect(PartnerWebhookEnvelopeSchema.safeParse({ ...envelope, unexpected: true }).success).toBe(
      false,
    );
  });

  it('publishes strict browser-safe demo contracts', () => {
    expect(DemoRunRequestSchema.parse({ run_id: 'run_12345678' })).toEqual({
      run_id: 'run_12345678',
    });
    expect(
      DemoRunRequestSchema.safeParse({ run_id: '../unsafe', scenario: 'anything' }).success,
    ).toBe(false);
    expect(
      DemoPaymentSnapshotSchema.safeParse({
        scenario: {
          key: 'trusted-payment',
          label: 'Trusted everyday payment',
          counterparty_name: 'Aarav Electronics',
          amount_paise: 24_900,
          direction: 'PUSH',
          claimed_goal: 'PAY_MERCHANT',
        },
      }).success,
    ).toBe(false);
  });

  it('publishes an evidence-backed fraud case contract', () => {
    const parsed = FraudCaseSnapshotSchema.safeParse({
      case_id: 'case_demo_refund',
      payment_intent_id: 'pi_demo_refund',
      status: 'OPEN',
      severity: 'CRITICAL',
      category: 'SOCIAL_ENGINEERING',
      summary: 'Deceptive refund collect request blocked before provider submission.',
      evidence: [
        {
          code: 'REFUND_COLLECT_CONFLICT',
          lens: 'INTENT',
          impact: 72,
          user_message: 'A collect request sends money; it does not receive a refund.',
          analyst_detail: 'Declared receive-refund goal conflicts with a debit collect request.',
          evidence_ref: 'payment_context:refund_collect_conflict',
        },
      ],
      timeline: [
        {
          event_id: 'ce_demo_refund',
          event_type: 'case.created',
          source: 'RISK_ENGINE',
          payload: { status: 'OPEN' },
          resource_version: 1,
          occurred_at: '2026-08-15T12:00:00.000Z',
        },
      ],
      resource_version: 1,
      opened_at: '2026-08-15T12:00:00.000Z',
      updated_at: '2026-08-15T12:00:00.000Z',
    });

    expect(parsed.success).toBe(true);
  });
});
