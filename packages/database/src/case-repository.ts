import type { CaseCategory, CaseEvidence, CaseSeverity, CaseStatus } from '@trinetra/contracts';
import {
  CaseIdentityConflictError,
  type CaseEventRecord,
  type CaseRepository,
  type EnsureCaseInput,
  type EnsureCaseResult,
  type FraudCaseRecord,
} from '@trinetra/case-core';
import { PaymentNotFoundError } from '@trinetra/payment-core';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface CaseRow extends QueryResultRow {
  internal_id: string;
  id: string;
  tenant_id: string;
  payment_id: string;
  status: CaseStatus;
  severity: CaseSeverity;
  category: CaseCategory;
  summary: string;
  evidence: readonly CaseEvidence[];
  resource_version: number;
  opened_at: Date | string;
  updated_at: Date | string;
}

interface CaseEventRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  case_id: string;
  event_key: string;
  event_type: 'case.created' | 'case.updated';
  source: string;
  payload: Readonly<Record<string, unknown>>;
  resource_version: number;
  occurred_at: Date | string;
}

const caseProjection = `
  c.id AS internal_id,
  c.external_ref AS id,
  c.tenant_id,
  p.external_ref AS payment_id,
  c.status,
  c.severity,
  c.category,
  c.summary,
  c.evidence,
  c.resource_version,
  c.opened_at,
  c.updated_at
`;

function asDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value);
}

function toCase(row: CaseRow): FraudCaseRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    paymentId: row.payment_id,
    status: row.status,
    severity: row.severity,
    category: row.category,
    summary: row.summary,
    evidence: structuredClone(row.evidence),
    resourceVersion: row.resource_version,
    openedAt: asDate(row.opened_at),
    updatedAt: asDate(row.updated_at),
  };
}

function toEvent(row: CaseEventRow): CaseEventRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    caseId: row.case_id,
    eventKey: row.event_key,
    eventType: row.event_type,
    source: row.source,
    payload: structuredClone(row.payload),
    resourceVersion: row.resource_version,
    occurredAt: asDate(row.occurred_at),
  };
}

export class PostgresCaseRepository implements CaseRepository {
  constructor(private readonly pool: Pool) {}

  async ensureCase(input: EnsureCaseInput): Promise<EnsureCaseResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await this.#findByIdentity(
        client,
        input.tenantId,
        input.caseId,
        input.paymentId,
      );
      if (existing) {
        this.#assertIdentity(existing, input);
        await client.query('COMMIT');
        return { outcome: 'REPLAY', fraudCase: toCase(existing) };
      }

      const payment = await client.query<{ id: string }>(
        `SELECT id
           FROM payment_intents
          WHERE tenant_id = $1 AND external_ref = $2`,
        [input.tenantId, input.paymentId],
      );
      const paymentInternalId = payment.rows[0]?.id;
      if (!paymentInternalId) throw new PaymentNotFoundError(input.paymentId);

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO cases (
           tenant_id, external_ref, payment_intent_id, status, severity, category,
           summary, evidence, resource_version, opened_at, updated_at
         ) VALUES ($1, $2, $3, 'OPEN', $4, $5, $6, $7, 1, $8, $8)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          input.tenantId,
          input.caseId,
          paymentInternalId,
          input.severity,
          input.category,
          input.summary,
          JSON.stringify(input.evidence),
          input.now,
        ],
      );

      if (!inserted.rows[0]) {
        const raced = await this.#findByIdentity(
          client,
          input.tenantId,
          input.caseId,
          input.paymentId,
        );
        if (!raced) throw new CaseIdentityConflictError();
        this.#assertIdentity(raced, input);
        await client.query('COMMIT');
        return { outcome: 'REPLAY', fraudCase: toCase(raced) };
      }

      const eventKey = `${input.caseId}:created`;
      const payload = {
        payment_id: input.paymentId,
        status: 'OPEN',
        severity: input.severity,
        reason_codes: input.evidence.map((item) => item.code),
      };
      await client.query(
        `INSERT INTO case_events (
           tenant_id, case_id, event_key, event_type, source, payload,
           resource_version, occurred_at
         ) VALUES ($1, $2, $3, 'case.created', 'RISK_ENGINE', $4, 1, $5)`,
        [input.tenantId, inserted.rows[0].id, eventKey, payload, input.now],
      );
      await client.query(
        `INSERT INTO outbox_events (
           tenant_id, aggregate_type, aggregate_id, event_key, event_type,
           payload, created_at, available_at
         ) VALUES ($1, 'case', $2, $3, 'case.created', $4, $5, $5)`,
        [input.tenantId, inserted.rows[0].id, eventKey, payload, input.now],
      );

      const created = await this.#findByIdentity(
        client,
        input.tenantId,
        input.caseId,
        input.paymentId,
      );
      if (!created) throw new Error('Created fraud case could not be read back.');
      await client.query('COMMIT');
      return { outcome: 'CREATED', fraudCase: toCase(created) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getCase(tenantId: string, caseId: string): Promise<FraudCaseRecord | null> {
    const result = await this.pool.query<CaseRow>(
      `SELECT ${caseProjection}
         FROM cases c
         JOIN payment_intents p
           ON p.tenant_id = c.tenant_id AND p.id = c.payment_intent_id
        WHERE c.tenant_id = $1 AND c.external_ref = $2`,
      [tenantId, caseId],
    );
    return result.rows[0] ? toCase(result.rows[0]) : null;
  }

  async getCaseByPayment(tenantId: string, paymentId: string): Promise<FraudCaseRecord | null> {
    const result = await this.pool.query<CaseRow>(
      `SELECT ${caseProjection}
         FROM cases c
         JOIN payment_intents p
           ON p.tenant_id = c.tenant_id AND p.id = c.payment_intent_id
        WHERE c.tenant_id = $1 AND p.external_ref = $2`,
      [tenantId, paymentId],
    );
    return result.rows[0] ? toCase(result.rows[0]) : null;
  }

  async listCases(tenantId: string, limit: number): Promise<FraudCaseRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('Case list limit must be between 1 and 100.');
    }
    const result = await this.pool.query<CaseRow>(
      `SELECT ${caseProjection}
         FROM cases c
         JOIN payment_intents p
           ON p.tenant_id = c.tenant_id AND p.id = c.payment_intent_id
        WHERE c.tenant_id = $1
        ORDER BY c.opened_at DESC, c.external_ref DESC
        LIMIT $2`,
      [tenantId, limit],
    );
    return result.rows.map(toCase);
  }

  async listCaseEvents(tenantId: string, caseId: string): Promise<CaseEventRecord[]> {
    const result = await this.pool.query<CaseEventRow>(
      `SELECT ce.id, ce.tenant_id, c.external_ref AS case_id, ce.event_key,
              ce.event_type, ce.source, ce.payload, ce.resource_version, ce.occurred_at
         FROM case_events ce
         JOIN cases c ON c.tenant_id = ce.tenant_id AND c.id = ce.case_id
        WHERE ce.tenant_id = $1 AND c.external_ref = $2
        ORDER BY ce.resource_version ASC, ce.occurred_at ASC, ce.id ASC`,
      [tenantId, caseId],
    );
    return result.rows.map(toEvent);
  }

  async #findByIdentity(
    client: PoolClient,
    tenantId: string,
    caseId: string,
    paymentId: string,
  ): Promise<CaseRow | null> {
    const result = await client.query<CaseRow>(
      `SELECT ${caseProjection}
         FROM cases c
         JOIN payment_intents p
           ON p.tenant_id = c.tenant_id AND p.id = c.payment_intent_id
        WHERE c.tenant_id = $1 AND (c.external_ref = $2 OR p.external_ref = $3)`,
      [tenantId, caseId, paymentId],
    );
    return result.rows[0] ?? null;
  }

  #assertIdentity(existing: CaseRow, input: EnsureCaseInput): void {
    if (existing.id !== input.caseId || existing.payment_id !== input.paymentId) {
      throw new CaseIdentityConflictError();
    }
  }
}
