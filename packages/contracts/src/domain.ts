import { z } from 'zod';

export const RISK_DECISIONS = ['ALLOW', 'WARN', 'STEP_UP', 'BLOCK'] as const;
export const RiskDecisionSchema = z.enum(RISK_DECISIONS);
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;

export const NetraLensSchema = z.enum(['IDENTITY', 'INTENT', 'INTEGRITY']);
export type NetraLens = z.infer<typeof NetraLensSchema>;

export const PaymentDirectionSchema = z.enum(['PUSH', 'COLLECT']);
export type PaymentDirection = z.infer<typeof PaymentDirectionSchema>;

export const PaymentTypeSchema = z.enum(['P2P', 'P2M']);
export type PaymentType = z.infer<typeof PaymentTypeSchema>;

export const PAYMENT_STATES = [
  'CREATED',
  'RISK_EVALUATING',
  'ALLOWED',
  'CHALLENGED',
  'BLOCKED',
  'SUBMITTED',
  'PENDING',
  'SUCCEEDED',
  'FAILED_SOFT',
  'FAILED_HARD',
  'REVERSAL_PENDING',
  'REVERSED',
  'DISPUTED',
  'CLOSED',
] as const;
export const PaymentStateSchema = z.enum(PAYMENT_STATES);
export type PaymentState = z.infer<typeof PaymentStateSchema>;

export const RiskReasonCodeSchema = z.enum([
  'UNKNOWN_DEVICE',
  'NEW_BENEFICIARY',
  'AMOUNT_ABOVE_USER_P99',
  'REFUND_COLLECT_CONFLICT',
  'PAYEE_MERCHANT_MISMATCH',
  'REMOTE_ACCESS_ACTIVE',
  'GRAPH_LINKED_DESTINATION',
]);
export type RiskReasonCode = z.infer<typeof RiskReasonCodeSchema>;

export const CASE_STATUSES = ['OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED'] as const;
export const CaseStatusSchema = z.enum(CASE_STATUSES);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

export const CASE_SEVERITIES = ['MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const CaseSeveritySchema = z.enum(CASE_SEVERITIES);
export type CaseSeverity = z.infer<typeof CaseSeveritySchema>;

export const CASE_CATEGORIES = ['SOCIAL_ENGINEERING', 'RISK_REVIEW'] as const;
export const CaseCategorySchema = z.enum(CASE_CATEGORIES);
export type CaseCategory = z.infer<typeof CaseCategorySchema>;

export const DomainEventTypeSchema = z.enum([
  'payment_intent.created',
  'risk_assessment.completed',
  'risk_decision.allowed',
  'risk_decision.warned',
  'risk_decision.challenged',
  'risk_decision.blocked',
  'payment.submitted',
  'payment.state_changed',
  'payment.provider_event_received',
  'payment.status_inquiry_requested',
  'payment.pending_timeout',
  'payment.reversal_due',
  'payment.reversed',
  'fraud_report.created',
  'case.created',
  'case.updated',
  'dispute.created',
  'dispute.sla_at_risk',
  'rule_version.published',
]);
export type DomainEventType = z.infer<typeof DomainEventTypeSchema>;
