import type {
  CaseCategory,
  CaseEvidence,
  CaseSeverity,
  CaseStatus,
  RiskAssessment,
  RiskReasonCode,
} from '@trinetra/contracts';

export interface FraudCaseRecord {
  id: string;
  tenantId: string;
  paymentId: string;
  status: CaseStatus;
  severity: CaseSeverity;
  category: CaseCategory;
  summary: string;
  evidence: readonly CaseEvidence[];
  resourceVersion: number;
  openedAt: Date;
  updatedAt: Date;
}

export interface CaseEventRecord {
  id: string;
  tenantId: string;
  caseId: string;
  eventKey: string;
  eventType: 'case.created' | 'case.updated';
  source: string;
  payload: Readonly<Record<string, unknown>>;
  resourceVersion: number;
  occurredAt: Date;
}

export interface EnsureCaseInput {
  caseId: string;
  tenantId: string;
  paymentId: string;
  severity: CaseSeverity;
  category: CaseCategory;
  summary: string;
  evidence: readonly CaseEvidence[];
  now: Date;
}

export interface EnsureCaseResult {
  outcome: 'CREATED' | 'REPLAY';
  fraudCase: FraudCaseRecord;
}

export interface CaseRepository {
  ensureCase(input: EnsureCaseInput): Promise<EnsureCaseResult>;
  getCase(tenantId: string, caseId: string): Promise<FraudCaseRecord | null>;
  getCaseByPayment(tenantId: string, paymentId: string): Promise<FraudCaseRecord | null>;
  listCases(tenantId: string, limit: number): Promise<FraudCaseRecord[]>;
  listCaseEvents(tenantId: string, caseId: string): Promise<CaseEventRecord[]>;
}

export class CaseIdentityConflictError extends Error {
  constructor() {
    super('The case identifier or payment is already bound to another fraud case.');
    this.name = 'CaseIdentityConflictError';
  }
}

const evidenceDefinition: Readonly<
  Record<RiskReasonCode, Pick<CaseEvidence, 'lens' | 'analyst_detail' | 'evidence_ref'>>
> = {
  UNKNOWN_DEVICE: {
    lens: 'IDENTITY',
    analyst_detail: 'Partner device token is absent from the exact tenant trust allow-list.',
    evidence_ref: 'device:trust_unknown',
  },
  NEW_BENEFICIARY: {
    lens: 'INTENT',
    analyst_detail: 'No prior successful relationship exists for this tokenised beneficiary.',
    evidence_ref: 'relationship:beneficiary_first_seen',
  },
  AMOUNT_ABOVE_USER_P99: {
    lens: 'INTENT',
    analyst_detail: 'Amount exceeds the configured synthetic customer baseline.',
    evidence_ref: 'baseline:amount_above_p99',
  },
  REFUND_COLLECT_CONFLICT: {
    lens: 'INTENT',
    analyst_detail: 'Declared receive-refund goal conflicts with a COLLECT flow that can debit.',
    evidence_ref: 'payment_context:refund_collect_conflict',
  },
  PAYEE_MERCHANT_MISMATCH: {
    lens: 'INTEGRITY',
    analyst_detail: 'Normalised resolved receiver does not match the selected merchant.',
    evidence_ref: 'merchant:resolved_name_mismatch',
  },
  REMOTE_ACCESS_ACTIVE: {
    lens: 'INTEGRITY',
    analyst_detail: 'Partner context reports an active remote-control or screen-sharing session.',
    evidence_ref: 'device:remote_access_active',
  },
  GRAPH_EVIDENCE_TRUNCATED: {
    lens: 'INTEGRITY',
    analyst_detail: 'Bounded graph traversal reached its configured node or edge review limit.',
    evidence_ref: 'graph:traversal_truncated',
  },
  GRAPH_LINKED_DESTINATION: {
    lens: 'INTEGRITY',
    analyst_detail: 'Tokenised destination is linked to a bounded synthetic risk cluster.',
    evidence_ref: 'graph:bounded_risk_link',
  },
};

function evidenceFor(assessment: RiskAssessment): CaseEvidence[] {
  return assessment.reasons.map((reason) => ({
    code: reason.code,
    impact: reason.impact,
    user_message: reason.user_message,
    ...evidenceDefinition[reason.code],
  }));
}

export class CaseService {
  readonly #repository: CaseRepository;
  readonly #now: () => Date;

  constructor(repository: CaseRepository, now: () => Date = () => new Date()) {
    this.#repository = repository;
    this.#now = now;
  }

  async ensureBlockedPaymentCase(
    tenantId: string,
    paymentId: string,
    assessment: RiskAssessment,
  ): Promise<EnsureCaseResult | null> {
    if (assessment.decision !== 'BLOCK') return null;
    if (!assessment.case_id) throw new Error('A BLOCK assessment must publish a case identifier.');
    const evidence = evidenceFor(assessment);
    if (evidence.length === 0) throw new Error('A BLOCK assessment must contain case evidence.');

    const refundCollect = evidence.some((item) => item.code === 'REFUND_COLLECT_CONFLICT');
    const graphLinked = evidence.some((item) => item.code === 'GRAPH_LINKED_DESTINATION');
    const socialEngineering =
      refundCollect || evidence.some((item) => item.code === 'REMOTE_ACCESS_ACTIVE');
    return await this.#repository.ensureCase({
      caseId: assessment.case_id,
      tenantId,
      paymentId,
      severity: socialEngineering ? 'CRITICAL' : 'HIGH',
      category: socialEngineering ? 'SOCIAL_ENGINEERING' : 'RISK_REVIEW',
      summary: refundCollect
        ? 'Deceptive refund collect request blocked before provider submission.'
        : socialEngineering
          ? 'High-risk social-engineering context blocked before provider submission.'
          : graphLinked
            ? 'Graph-linked destination blocked for bounded analyst review.'
            : 'Blocked payment requires analyst review.',
      evidence,
      now: this.#now(),
    });
  }
}
