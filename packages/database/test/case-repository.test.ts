import { randomUUID } from 'node:crypto';

import { DataType, newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { CaseIdentityConflictError } from '@trinetra/case-core';

import { PostgresCaseRepository } from '../src/index.js';

const tenantA = '00000000-0000-4000-8000-000000000001';
const tenantB = '00000000-0000-4000-8000-000000000002';
const fixedNow = new Date('2026-08-15T12:00:00.000Z');

const testSchema = `
  CREATE TYPE payment_state AS ENUM (
    'CREATED', 'RISK_EVALUATING', 'ALLOWED', 'CHALLENGED', 'BLOCKED', 'SUBMITTED',
    'PENDING', 'SUCCEEDED', 'FAILED_SOFT', 'FAILED_HARD', 'REVERSAL_PENDING',
    'REVERSED', 'DISPUTED', 'CLOSED'
  );
  CREATE TYPE risk_decision AS ENUM ('ALLOW', 'WARN', 'STEP_UP', 'BLOCK');
  CREATE TYPE case_status AS ENUM ('OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED');
  CREATE TYPE case_severity AS ENUM ('MEDIUM', 'HIGH', 'CRITICAL');
  CREATE TYPE case_category AS ENUM ('SOCIAL_ENGINEERING', 'RISK_REVIEW');

  CREATE TABLE tenants (
    id uuid PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE payment_intents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    partner_customer_ref text NOT NULL,
    external_ref text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    request_body jsonb NOT NULL,
    response_body jsonb NOT NULL,
    amount_paise integer NOT NULL,
    currency text NOT NULL DEFAULT 'INR',
    state payment_state NOT NULL DEFAULT 'CREATED',
    decision risk_decision,
    resource_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, external_ref)
  );
  CREATE TABLE cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    external_ref text NOT NULL,
    payment_intent_id uuid NOT NULL,
    status case_status NOT NULL DEFAULT 'OPEN',
    severity case_severity NOT NULL,
    category case_category NOT NULL,
    summary text NOT NULL,
    evidence jsonb NOT NULL,
    resource_version integer NOT NULL DEFAULT 1,
    opened_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, external_ref),
    UNIQUE (tenant_id, payment_intent_id),
    FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment_intents(tenant_id, id)
  );
  CREATE TABLE case_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    case_id uuid NOT NULL,
    event_key text NOT NULL,
    event_type text NOT NULL,
    source text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}',
    resource_version integer NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, case_id, event_key),
    FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id)
  );
  CREATE TABLE outbox_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_key text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    available_at timestamptz NOT NULL DEFAULT now(),
    publish_attempts integer NOT NULL DEFAULT 0,
    published_at timestamptz,
    UNIQUE (tenant_id, event_key)
  );
`;

const pools: Pool[] = [];

async function buildHarness() {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    impure: true,
    implementation: randomUUID,
  });
  memory.public.none(testSchema);
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool() as Pool;
  pools.push(pool);
  await pool.query(
    `INSERT INTO tenants (id, slug, name)
     VALUES ($1, 'tenant-a', 'Tenant A'), ($2, 'tenant-b', 'Tenant B')`,
    [tenantA, tenantB],
  );
  for (const paymentId of ['pi_case_payment_001', 'pi_case_payment_002']) {
    await pool.query(
      `INSERT INTO payment_intents (
         tenant_id, partner_customer_ref, external_ref, idempotency_key, request_hash,
         request_body, response_body, amount_paise, state, decision
       ) VALUES ($1, 'cust_case', $2, $3, $4, '{}', '{}', 199900, 'BLOCKED', 'BLOCK')`,
      [tenantA, paymentId, `idem_${paymentId}`, `hash_${paymentId}`],
    );
  }
  return { pool, repository: new PostgresCaseRepository(pool) };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map(async (pool) => await pool.end()));
});

describe('Postgres fraud case repository', () => {
  it('persists one tenant-scoped case, event, and outbox record with replay safety', async () => {
    const { pool, repository } = await buildHarness();
    const input = {
      caseId: 'case_payment_001',
      tenantId: tenantA,
      paymentId: 'pi_case_payment_001',
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
      now: fixedNow,
    } as const;

    expect(await repository.ensureCase(input)).toMatchObject({
      outcome: 'CREATED',
      fraudCase: { id: 'case_payment_001', paymentId: 'pi_case_payment_001', status: 'OPEN' },
    });
    expect((await repository.ensureCase(input)).outcome).toBe('REPLAY');
    expect(await repository.getCaseByPayment(tenantB, input.paymentId)).toBeNull();
    expect(await repository.listCases(tenantB, 10)).toEqual([]);
    expect(await repository.listCaseEvents(tenantA, input.caseId)).toEqual([
      expect.objectContaining({ eventType: 'case.created', resourceVersion: 1 }),
    ]);
    expect(
      await pool.query(
        `SELECT aggregate_type, event_type FROM outbox_events WHERE tenant_id = $1`,
        [tenantA],
      ),
    ).toMatchObject({ rows: [{ aggregate_type: 'case', event_type: 'case.created' }] });

    await expect(
      repository.ensureCase({ ...input, paymentId: 'pi_case_payment_002' }),
    ).rejects.toThrow(CaseIdentityConflictError);
    await expect(repository.ensureCase({ ...input, caseId: 'case_payment_002' })).rejects.toThrow(
      CaseIdentityConflictError,
    );
  });
});
