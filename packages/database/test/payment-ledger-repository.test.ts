import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const sql0 = readFileSync(
  resolve(import.meta.dirname, '../drizzle/0000_white_red_ghost.sql'),
  'utf-8',
);
const sql1 = readFileSync(
  resolve(import.meta.dirname, '../drizzle/0001_free_supreme_intelligence.sql'),
  'utf-8',
);

/**
 * pg-mem supports very few SQL functions (no replace(), md5(), jsonb_build_object()).
 * The UPDATE data-migration blocks in migration 0001 use those functions but operate
 * on rows that don't exist in a fresh test DB, so we can safely strip them.
 * We split on the Drizzle statement-breakpoint marker, drop any UPDATE statements,
 * then re-join so each statement ends with exactly one semicolon.
 */
function forPgMem(sql: string): string {
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\s*UPDATE\s/i.test(s))
    .join('\n');
}

const pools: Pool[] = [];

async function buildHarness() {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    impure: true,
    implementation: randomUUID,
  });
  memory.public.none(forPgMem(sql0));
  memory.public.none(forPgMem(sql1));
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
