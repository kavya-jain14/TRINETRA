import { describe, expect, it } from 'vitest';

import { PaymentIntentRequestSchema, RiskAssessmentSchema } from '../src/index.js';

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
});
