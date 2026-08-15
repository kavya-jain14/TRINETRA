import { z } from 'zod';

import {
  CaseCategorySchema,
  CaseSeveritySchema,
  CaseStatusSchema,
  NetraLensSchema,
  RiskReasonCodeSchema,
} from './domain.js';

export const CaseEvidenceSchema = z.object({
  code: RiskReasonCodeSchema,
  lens: NetraLensSchema,
  impact: z.number().int().min(0).max(100),
  user_message: z.string().min(1),
  analyst_detail: z.string().min(1),
  evidence_ref: z.string().regex(/^[a-z][a-z0-9_-]*:[a-z0-9_.-]+$/),
});
export type CaseEvidence = z.infer<typeof CaseEvidenceSchema>;

export const CaseEventSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.enum(['case.created', 'case.updated']),
  source: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  resource_version: z.number().int().positive(),
  occurred_at: z.string().datetime({ offset: true }),
});
export type CaseEvent = z.infer<typeof CaseEventSchema>;

export const FraudCaseSnapshotSchema = z.object({
  case_id: z.string().startsWith('case_').max(104),
  payment_intent_id: z.string().startsWith('pi_').max(96),
  status: CaseStatusSchema,
  severity: CaseSeveritySchema,
  category: CaseCategorySchema,
  summary: z.string().min(1).max(240),
  evidence: z.array(CaseEvidenceSchema).min(1),
  timeline: z.array(CaseEventSchema).min(1),
  resource_version: z.number().int().positive(),
  opened_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type FraudCaseSnapshot = z.infer<typeof FraudCaseSnapshotSchema>;

export const FraudCaseListSchema = z.object({
  cases: z.array(FraudCaseSnapshotSchema),
});
export type FraudCaseList = z.infer<typeof FraudCaseListSchema>;
