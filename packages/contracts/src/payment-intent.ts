import { z } from 'zod';

import {
  PaymentDirectionSchema,
  PaymentTypeSchema,
  RiskDecisionSchema,
  RiskReasonCodeSchema,
} from './domain.js';

export const PaymentIntentRequestSchema = z
  .object({
    partner_customer_ref: z.string().min(3).max(128),
    direction: PaymentDirectionSchema,
    payment_type: PaymentTypeSchema,
    amount_paise: z.number().int().positive().max(100_000_000),
    currency: z.literal('INR'),
    beneficiary: z.object({
      vpa_token: z.string().min(8).max(160),
      resolved_name: z.string().min(2).max(160),
    }),
    merchant: z
      .object({
        merchant_ref: z.string().min(3).max(128),
        expected_name: z.string().min(2).max(160),
        mcc: z.string().regex(/^\d{4}$/),
      })
      .optional(),
    context: z.object({
      channel: z.enum(['UPI_INTENT', 'UPI_QR', 'UPI_COLLECT']),
      device_token: z.string().min(8).max(160),
      session_ref: z.string().min(6).max(128),
      user_claimed_goal: z.enum(['PAY_MERCHANT', 'PAY_PERSON', 'RECEIVE_REFUND']),
      remote_access_active: z.boolean(),
    }),
  })
  .strict();
export type PaymentIntentRequest = z.infer<typeof PaymentIntentRequestSchema>;

export const RiskReasonSchema = z.object({
  code: RiskReasonCodeSchema,
  impact: z.number().int().min(0).max(100),
  user_message: z.string().min(1),
});
export type RiskReason = z.infer<typeof RiskReasonSchema>;

export const RiskAssessmentSchema = z.object({
  payment_intent_id: z.string().startsWith('pi_'),
  decision: RiskDecisionSchema,
  risk_score: z.number().int().min(0).max(100),
  subscores: z.object({
    identity: z.number().int().min(0).max(100),
    intent: z.number().int().min(0).max(100),
    integrity: z.number().int().min(0).max(100),
  }),
  reasons: z.array(RiskReasonSchema),
  required_action: z.object({
    type: z.enum(['NONE', 'ACKNOWLEDGE_WARNING', 'RECONFIRM_RECEIVER', 'STOP_PAYMENT']),
    expires_at: z.string().datetime({ offset: true }),
  }),
  rule_set_version: z.string().min(1),
  case_id: z.string().nullable(),
  trace_id: z.string().min(1),
  resource_version: z.number().int().positive(),
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
