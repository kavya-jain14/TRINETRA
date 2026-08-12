import { z } from 'zod';

import { PaymentStateSchema } from './domain.js';

export const PROVIDER_SCENARIOS = [
  'SUCCESS_IMMEDIATE',
  'PENDING_THEN_SUCCESS',
  'PENDING_THEN_REVERSED',
  'SOFT_DECLINE',
  'HARD_DECLINE',
  'TIMEOUT_UNKNOWN',
  'DUPLICATE_CALLBACK',
  'OUT_OF_ORDER_CALLBACK',
  'INVALID_SIGNATURE_CALLBACK',
] as const;
export const ProviderScenarioSchema = z.enum(PROVIDER_SCENARIOS);
export type ProviderScenario = z.infer<typeof ProviderScenarioSchema>;

export const PROVIDER_PAYMENT_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED_SOFT',
  'FAILED_HARD',
  'REVERSAL_PENDING',
  'REVERSED',
] as const;
export const ProviderPaymentStatusSchema = z.enum(PROVIDER_PAYMENT_STATUSES);
export type ProviderPaymentStatus = z.infer<typeof ProviderPaymentStatusSchema>;

export const PaymentSubmissionRequestSchema = z
  .object({
    scenario: ProviderScenarioSchema.default('SUCCESS_IMMEDIATE'),
  })
  .strict();
export type PaymentSubmissionRequest = z.infer<typeof PaymentSubmissionRequestSchema>;

export const ProviderCallbackSchema = z
  .object({
    event_id: z.string().startsWith('pe_').max(96),
    payment_id: z.string().startsWith('pi_').max(96),
    provider_ref: z.string().startsWith('psp_').max(160),
    status: ProviderPaymentStatusSchema,
    amount_paise: z.number().int().positive().max(100_000_000),
    occurred_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type ProviderCallback = z.infer<typeof ProviderCallbackSchema>;

export const PaymentResourceSchema = z.object({
  payment_intent_id: z.string().startsWith('pi_'),
  state: PaymentStateSchema,
  provider_request_ref: z.string().startsWith('psp_').nullable(),
  resource_version: z.number().int().positive(),
  updated_at: z.string().datetime({ offset: true }),
});
export type PaymentResource = z.infer<typeof PaymentResourceSchema>;

export const PaymentOperationResultSchema = z.object({
  outcome: z.enum(['APPLIED', 'DUPLICATE', 'IGNORED_STALE']),
  payment: PaymentResourceSchema,
});
export type PaymentOperationResult = z.infer<typeof PaymentOperationResultSchema>;

export const ProviderCallbackAckSchema = z.object({
  event_id: z.string().startsWith('pe_'),
  outcome: z.enum(['APPLIED', 'DUPLICATE', 'IGNORED_STALE']),
  payment: PaymentResourceSchema,
});
export type ProviderCallbackAck = z.infer<typeof ProviderCallbackAckSchema>;
