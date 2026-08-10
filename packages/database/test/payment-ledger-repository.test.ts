import { randomUUID } from 'node:crypto';

import { DataType, newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DeterministicPaymentProviderAdapter,
  IdempotencyConflictError,
  PaymentLedgerService,
  PaymentNotFoundError,
} from '@trinetra/payment-core';

import { PostgresPaymentLedgerRepository } from '../src/index.js';

const tenantA = '00000000-0000-4000-8000-000000000001';
const tenantB = '00000000-0000-4000-8000-000000000002';
const fixedNow = new Date('2026-08-10T12:00:00.000Z');

const testSchema = `
  CREATE TYPE payment_state AS ENUM (
    'CREATED', 'RISK_EVALUATING', 'ALLOWED', 'CHALLENGED', 'BLOCKED', 'SUBMITTED',
    'PENDING', 'SUCCEEDED', 'FAILED_SOFT', 'FAILED_HARD', 'REVERSAL_PENDING',
    'REVERSED', 'DISPUTED', 'CLOSED'
  );
  CREATE TYPE risk_decision AS ENUM ('ALLOW', 'WARN', 'STEP_UP', 'BLOCK');
  CREATE TYPE provider_payment_status AS ENUM (
    'PENDING', 'SUCCEEDED', 'FAILED_SOFT', 'FAILED_HARD', 'REVERSAL_PENDING', 'REVERSED'
  );
  CREATE TYPE provider_attempt_operation AS ENUM ('SUBMIT', 'STATUS_INQUIRY');
  CREATE TYPE provider_attempt_status AS ENUM ('STARTED', 'COMPLETED', 'UNKNOWN');

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
    provider_request_reference text,
    resource_version integer NOT NULL DEFAULT 1,
    submitted_at timestamptz,
    pending_since timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, external_ref),
    UNIQUE (tenant_id, idempotency_key),
    UNIQUE (tenant_id, provider_request_reference)
  );
  CREATE TABLE idempotency_records (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    operation text NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    payment_external_ref text NOT NULL,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, operation, key)
  );
  CREATE TABLE payment_state_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    payment_intent_id uuid NOT NULL,
    event_key text NOT NULL,
    from_state payment_state,
    to_state payment_state NOT NULL,
    source text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}',
    resource_version integer NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment_intents(tenant_id, id),
    UNIQUE (tenant_id, payment_intent_id, event_key)
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
  CREATE TABLE provider_attempts (
    id text PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    payment_intent_id uuid NOT NULL,
    provider text NOT NULL,
    operation provider_attempt_operation NOT NULL,
    request_reference text NOT NULL,
    request_hash text NOT NULL,
    status provider_attempt_status NOT NULL DEFAULT 'STARTED',
    provider_status provider_payment_status,
    response_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment_intents(tenant_id, id),
    UNIQUE (tenant_id, provider, request_reference)
  );
  CREATE TABLE provider_events (
    id text PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    payment_intent_id uuid NOT NULL,
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    provider_reference text NOT NULL,
    provider_status provider_payment_status NOT NULL,
    payload_hash text NOT NULL,
    amount_paise integer NOT NULL,
    applied boolean NOT NULL DEFAULT false,
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment_intents(tenant_id, id),
    UNIQUE (tenant_id, provider, provider_event_id)
  );
  CREATE TABLE payment_recovery_clocks (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    payment_intent_id uuid NOT NULL,
    status_check_due_at timestamptz,
    pending_expires_at timestamptz,
    reversal_due_at timestamptz,
    complaint_eligible_at timestamptz,
    resolved_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, payment_intent_id),
    FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment_intents(tenant_id, id)
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

  const repository = new PostgresPaymentLedgerRepository(pool);
  const provider = new DeterministicPaymentProviderAdapter();
  let id = 0;
  const service = new PaymentLedgerService({
    repository,
    provider,
    now: () => fixedNow,
    idFactory: () => String(++id).padStart(8, '0'),
  });
  return { pool, provider, repository, service };
}

async function createAllowed(service: PaymentLedgerService) {
  return await service.createRiskEvaluatedPayment({
    paymentId: 'pi_pg_payment_001',
    tenantId: tenantA,
    partnerCustomerRef: 'cust_pg_001',
    idempotencyKey: 'idem_pg_001',
    requestHash: 'hash_pg_001',
    requestBody: { amount_paise: 24_900 },
    responseBody: { payment_intent_id: 'pi_pg_payment_001', decision: 'ALLOW' },
    amountPaise: 24_900,
    currency: 'INR',
    decision: 'ALLOW',
  });
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map(async (pool) => await pool.end()));
});

describe('Postgres payment ledger repository', () => {
  it('persists monotonic event/outbox history and deduplicates provider callbacks', async () => {
    const { repository, service } = await buildHarness();
    await createAllowed(service);
    await service.submitPayment(tenantA, 'pi_pg_payment_001', 'PENDING_THEN_SUCCESS');

    const callback = {
      event_id: 'pe_pg_success_001',
      payment_id: 'pi_pg_payment_001',
      provider_ref: 'psp_pg_payment_001',
      status: 'SUCCEEDED',
      amount_paise: 24_900,
      occurred_at: fixedNow.toISOString(),
    } as const;
    expect((await service.applyProviderCallback(tenantA, callback, 'payload_hash')).outcome).toBe(
      'APPLIED',
    );
    expect((await service.applyProviderCallback(tenantA, callback, 'payload_hash')).outcome).toBe(
      'DUPLICATE',
    );

    const stale = { ...callback, event_id: 'pe_pg_stale_001', status: 'PENDING' } as const;
    expect((await service.applyProviderCallback(tenantA, stale, 'stale_hash')).outcome).toBe(
      'IGNORED_STALE',
    );
    const events = await repository.listStateEvents(tenantA, 'pi_pg_payment_001');
    const outbox = await repository.listOutboxEvents(tenantA, 'pi_pg_payment_001');
    expect(events.map((event) => event.toState)).toEqual([
      'CREATED',
      'RISK_EVALUATING',
      'ALLOWED',
      'SUBMITTED',
      'PENDING',
      'SUCCEEDED',
    ]);
    expect(outbox).toHaveLength(events.length);
  });

  it('enforces tenant idempotency and tenant-scoped access', async () => {
    const { repository, service } = await buildHarness();
    await createAllowed(service);
    const replay = await service.createRiskEvaluatedPayment({
      paymentId: 'pi_pg_unused',
      tenantId: tenantA,
      partnerCustomerRef: 'cust_pg_001',
      idempotencyKey: 'idem_pg_001',
      requestHash: 'hash_pg_001',
      requestBody: { amount_paise: 24_900 },
      responseBody: { ignored: true },
      amountPaise: 24_900,
      currency: 'INR',
      decision: 'ALLOW',
    });
    expect(replay.outcome).toBe('REPLAY');
    expect(replay.payment.id).toBe('pi_pg_payment_001');
    expect(await repository.getPayment(tenantB, 'pi_pg_payment_001')).toBeNull();

    await expect(
      repository.transitionPayment({
        tenantId: tenantB,
        paymentId: 'pi_pg_payment_001',
        toState: 'SUBMITTED',
        eventKey: 'cross_tenant',
        source: 'TEST',
        now: fixedNow,
      }),
    ).rejects.toThrow(PaymentNotFoundError);

    await expect(
      service.createRiskEvaluatedPayment({
        paymentId: 'pi_pg_changed',
        tenantId: tenantA,
        partnerCustomerRef: 'cust_pg_001',
        idempotencyKey: 'idem_pg_001',
        requestHash: 'changed_hash',
        requestBody: { amount_paise: 25_000 },
        responseBody: { payment_intent_id: 'pi_pg_changed' },
        amountPaise: 25_000,
        currency: 'INR',
        decision: 'ALLOW',
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });
});
