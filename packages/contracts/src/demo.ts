import { z } from 'zod';

import { FraudCaseSnapshotSchema } from './case.js';
import { PaymentStateSchema } from './domain.js';
import { RiskAssessmentSchema } from './payment-intent.js';
import { PaymentResourceSchema, ProviderPaymentStatusSchema } from './payment-ledger.js';

export const DemoRunRequestSchema = z
  .object({
    run_id: z.string().regex(/^run_[a-z0-9]{8,64}$/),
  })
  .strict();
export type DemoRunRequest = z.infer<typeof DemoRunRequestSchema>;

export const DemoScenarioSchema = z.discriminatedUnion('key', [
  z.object({
    key: z.literal('trusted-payment'),
    label: z.literal('Trusted everyday payment'),
    counterparty_name: z.literal('Aarav Electronics'),
    amount_paise: z.literal(24_900),
    direction: z.literal('PUSH'),
    claimed_goal: z.literal('PAY_MERCHANT'),
  }),
  z.object({
    key: z.literal('refund-collect'),
    label: z.literal('Deceptive refund collect request'),
    counterparty_name: z.literal('Synthetic Refund Desk'),
    amount_paise: z.literal(199_900),
    direction: z.literal('COLLECT'),
    claimed_goal: z.literal('RECEIVE_REFUND'),
  }),
]);
export type DemoScenario = z.infer<typeof DemoScenarioSchema>;

export const PaymentTimelineEventSchema = z.object({
  event_id: z.string().min(1),
  from_state: PaymentStateSchema.nullable(),
  to_state: PaymentStateSchema,
  source: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()),
  resource_version: z.number().int().positive(),
  occurred_at: z.string().datetime({ offset: true }),
});
export type PaymentTimelineEvent = z.infer<typeof PaymentTimelineEventSchema>;

export const ProviderAttemptSummarySchema = z.object({
  attempt_id: z.string().min(1),
  operation: z.enum(['SUBMIT', 'STATUS_INQUIRY']),
  status: z.enum(['STARTED', 'COMPLETED', 'UNKNOWN']),
  provider_status: ProviderPaymentStatusSchema.nullable(),
  response_code: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable(),
});
export type ProviderAttemptSummary = z.infer<typeof ProviderAttemptSummarySchema>;

export const DemoPaymentSnapshotSchema = z.object({
  scenario: DemoScenarioSchema,
  assessment: RiskAssessmentSchema,
  payment: PaymentResourceSchema,
  timeline: z.array(PaymentTimelineEventSchema),
  provider_attempts: z.array(ProviderAttemptSummarySchema),
  fraud_case: FraudCaseSnapshotSchema.nullable(),
});
export type DemoPaymentSnapshot = z.infer<typeof DemoPaymentSnapshotSchema>;

export const DemoPaymentListSchema = z.object({
  payments: z.array(DemoPaymentSnapshotSchema),
});
export type DemoPaymentList = z.infer<typeof DemoPaymentListSchema>;
