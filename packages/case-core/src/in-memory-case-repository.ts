import {
  CaseIdentityConflictError,
  type CaseEventRecord,
  type CaseRepository,
  type EnsureCaseInput,
  type EnsureCaseResult,
  type FraudCaseRecord,
} from './case.js';

function caseKey(tenantId: string, caseId: string): string {
  return `${tenantId}:${caseId}`;
}

function paymentKey(tenantId: string, paymentId: string): string {
  return `${tenantId}:${paymentId}`;
}

function cloneCase(record: FraudCaseRecord): FraudCaseRecord {
  return {
    ...record,
    evidence: structuredClone(record.evidence),
    openedAt: new Date(record.openedAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function cloneEvent(record: CaseEventRecord): CaseEventRecord {
  return {
    ...record,
    payload: structuredClone(record.payload),
    occurredAt: new Date(record.occurredAt),
  };
}

export class InMemoryCaseRepository implements CaseRepository {
  readonly #cases = new Map<string, FraudCaseRecord>();
  readonly #caseByPayment = new Map<string, string>();
  readonly #events = new Map<string, CaseEventRecord[]>();

  async ensureCase(input: EnsureCaseInput): Promise<EnsureCaseResult> {
    const key = caseKey(input.tenantId, input.caseId);
    const paymentLookup = paymentKey(input.tenantId, input.paymentId);
    const existing = this.#cases.get(key);
    const caseForPayment = this.#caseByPayment.get(paymentLookup);
    if (existing || caseForPayment) {
      if (!existing || existing.paymentId !== input.paymentId || caseForPayment !== input.caseId) {
        throw new CaseIdentityConflictError();
      }
      return { outcome: 'REPLAY', fraudCase: cloneCase(existing) };
    }

    const fraudCase: FraudCaseRecord = {
      id: input.caseId,
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      status: 'OPEN',
      severity: input.severity,
      category: input.category,
      summary: input.summary,
      evidence: structuredClone(input.evidence),
      resourceVersion: 1,
      openedAt: new Date(input.now),
      updatedAt: new Date(input.now),
    };
    const event: CaseEventRecord = {
      id: `ce_${input.caseId}:created`,
      tenantId: input.tenantId,
      caseId: input.caseId,
      eventKey: `${input.caseId}:created`,
      eventType: 'case.created',
      source: 'RISK_ENGINE',
      payload: {
        payment_id: input.paymentId,
        status: 'OPEN',
        severity: input.severity,
        reason_codes: input.evidence.map((item) => item.code),
      },
      resourceVersion: 1,
      occurredAt: new Date(input.now),
    };
    this.#cases.set(key, fraudCase);
    this.#caseByPayment.set(paymentLookup, input.caseId);
    this.#events.set(key, [event]);
    return { outcome: 'CREATED', fraudCase: cloneCase(fraudCase) };
  }

  async getCase(tenantId: string, caseId: string): Promise<FraudCaseRecord | null> {
    const fraudCase = this.#cases.get(caseKey(tenantId, caseId));
    return fraudCase ? cloneCase(fraudCase) : null;
  }

  async getCaseByPayment(tenantId: string, paymentId: string): Promise<FraudCaseRecord | null> {
    const caseId = this.#caseByPayment.get(paymentKey(tenantId, paymentId));
    return caseId ? await this.getCase(tenantId, caseId) : null;
  }

  async listCases(tenantId: string, limit: number): Promise<FraudCaseRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('Case list limit must be between 1 and 100.');
    }
    return [...this.#cases.values()]
      .filter((fraudCase) => fraudCase.tenantId === tenantId)
      .sort((left, right) => {
        const byOpenedAt = right.openedAt.getTime() - left.openedAt.getTime();
        return byOpenedAt === 0 ? right.id.localeCompare(left.id) : byOpenedAt;
      })
      .slice(0, limit)
      .map(cloneCase);
  }

  async listCaseEvents(tenantId: string, caseId: string): Promise<CaseEventRecord[]> {
    return (this.#events.get(caseKey(tenantId, caseId)) ?? []).map(cloneEvent);
  }
}
