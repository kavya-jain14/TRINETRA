import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  ensureTenant,
  PostgresCaseRepository,
  PostgresDeterministicPaymentProviderAdapter,
  PostgresGraphRepository,
  PostgresPaymentLedgerRepository,
} from '@trinetra/database';
import { canonicalJson, RedisNonceStore, signPartnerRequest } from '@trinetra/security';

import { buildApp } from '../src/app.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const hasIntegrationServices = Boolean(databaseUrl && redisUrl);

describe.skipIf(!hasIntegrationServices)('PostgreSQL and Redis API integration', () => {
  const tenantId = randomUUID();
  const partnerSecret = 'integration-secret-with-at-least-32-characters';
  const fixedNow = new Date('2026-08-10T12:00:00.000Z');
  let pool: ReturnType<typeof createDatabase>['pool'];
  let redisPrimary: Redis;
  let redisReplica: Redis;
  let repository: PostgresPaymentLedgerRepository;
  let caseRepository: PostgresCaseRepository;
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  const intent = {
    partner_customer_ref: `cust_integration_${tenantId.slice(0, 8)}`,
    direction: 'PUSH',
    payment_type: 'P2M',
    amount_paise: 24_900,
    currency: 'INR',
    beneficiary: {
      vpa_token: 'vpa_tok_integration_merchant',
      resolved_name: 'Aarav Electronics',
    },
    merchant: {
      merchant_ref: `merchant_${tenantId.slice(0, 8)}`,
      expected_name: 'Aarav Electronics',
      mcc: '5732',
    },
    context: {
      channel: 'UPI_INTENT',
      device_token: 'dev_tok_integration_trusted',
      session_ref: `session_${tenantId.slice(0, 8)}`,
      user_claimed_goal: 'PAY_MERCHANT',
      remote_access_active: false,
    },
  } as const;

  function headers(nonce: string) {
    const timestamp = String(Math.floor(fixedNow.getTime() / 1000));
    return {
      'content-type': 'application/json',
      'idempotency-key': `idem_${tenantId}`,
      'x-partner-key': 'partner_integration',
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      'x-signature': signPartnerRequest(partnerSecret, {
        method: 'POST',
        path: '/v1/payment-intents',
        timestamp,
        nonce,
        body: canonicalJson(intent),
      }),
    };
  }

  beforeAll(async () => {
    ({ pool } = createDatabase(databaseUrl!));
    redisPrimary = new Redis(redisUrl!, { maxRetriesPerRequest: 1 });
    redisReplica = new Redis(redisUrl!, { maxRetriesPerRequest: 1 });
    repository = new PostgresPaymentLedgerRepository(pool);
    caseRepository = new PostgresCaseRepository(pool);

    await ensureTenant(pool, {
      id: tenantId,
      slug: `integration-${tenantId}`,
      name: 'TRINETRA API Integration Tenant',
    });

    const commonConfig = {
      partnerKey: 'partner_integration',
      partnerSecret,
      now: () => fixedNow,
      ledgerRepository: repository,
      caseRepository,
      graphRepository: new PostgresGraphRepository(pool),
      paymentProvider: new PostgresDeterministicPaymentProviderAdapter(pool),
      tenantId,
      trustedDeviceTokens: ['dev_tok_integration_trusted'],
      demoMode: true,
      readinessChecks: {
        postgresql: async () => {
          await pool.query('select 1');
        },
        redis: async () => {
          if ((await redisPrimary.ping()) !== 'PONG') throw new Error('Redis ping failed');
        },
      },
    } as const;

    apps.push(
      await buildApp({ ...commonConfig, nonceStore: new RedisNonceStore(redisPrimary) }),
      await buildApp({ ...commonConfig, nonceStore: new RedisNonceStore(redisReplica) }),
    );
  });

  afterAll(async () => {
    await Promise.all(apps.map(async (app) => await app.close()));
    await Promise.allSettled([redisPrimary.quit(), redisReplica.quit(), pool.end()]);
  });

  it('reports real dependency readiness and rejects a cross-replica replay', async () => {
    const primary = apps[0]!;
    const replica = apps[1]!;
    const nonce = `nonce_${randomUUID()}`;

    const readiness = await primary.inject({ method: 'GET', url: '/health/ready' });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({
      status: 'ready',
      dependencies: { persistence: 'postgresql', postgresql: 'ready', redis: 'ready' },
    });

    const created = await primary.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: headers(nonce),
      payload: intent,
    });
    expect(created.statusCode).toBe(201);

    const replayedAcrossReplica = await replica.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: headers(nonce),
      payload: intent,
    });
    expect(replayedAcrossReplica.statusCode).toBe(401);
    expect(replayedAcrossReplica.json().error.code).toBe('REPLAY_DETECTED');

    const persisted = await repository.getPayment(tenantId, created.json().payment_intent_id);
    expect(persisted).toMatchObject({
      tenantId,
      amountPaise: 24_900,
      state: 'ALLOWED',
    });
  });

  it('persists the golden demo timeline and exposes it across API replicas', async () => {
    const primary = apps[0]!;
    const replica = apps[1]!;
    const runId = `run_${randomUUID().replaceAll('-', '')}`;

    const created = await primary.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/trusted-payment/run',
      payload: { run_id: runId },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      assessment: { decision: 'ALLOW' },
      payment: { state: 'SUCCEEDED' },
    });

    const listed = await replica.inject({ method: 'GET', url: '/v1/demo/payments?limit=20' });
    expect(listed.statusCode).toBe(200);
    const persisted = listed
      .json()
      .payments.find(
        (payment: { payment: { payment_intent_id: string } }) =>
          payment.payment.payment_intent_id === created.json().payment.payment_intent_id,
      );
    if (!persisted) throw new Error('Golden demo payment was not visible on the second replica.');
    expect(persisted.timeline.map((event: { to_state: string }) => event.to_state)).toEqual([
      'CREATED',
      'RISK_EVALUATING',
      'ALLOWED',
      'SUBMITTED',
      'SUCCEEDED',
    ]);
  });

  it('recovers an accepted timeout across replicas without a duplicate submission', async () => {
    const primary = apps[0]!;
    const replica = apps[1]!;
    const runId = `run_${randomUUID().replaceAll('-', '')}`;

    const pending = await primary.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/timeout-recovery/run',
      payload: { run_id: runId },
    });
    const replayedAcrossReplica = await replica.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/timeout-recovery/run',
      payload: { run_id: runId },
    });
    const recoveredAcrossReplica = await replica.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/timeout-recovery/recover',
      payload: { run_id: runId },
    });

    expect(pending.statusCode).toBe(201);
    expect(pending.json()).toMatchObject({
      payment: { state: 'PENDING' },
      provider_attempts: [
        { operation: 'SUBMIT', status: 'UNKNOWN', response_code: 'TIMEOUT_UNKNOWN' },
      ],
    });
    expect(replayedAcrossReplica.statusCode).toBe(200);
    expect(replayedAcrossReplica.json().payment.payment_intent_id).toBe(
      pending.json().payment.payment_intent_id,
    );
    expect(replayedAcrossReplica.json().provider_attempts).toHaveLength(1);
    expect(recoveredAcrossReplica.statusCode).toBe(200);
    expect(recoveredAcrossReplica.json().payment.state).toBe('SUCCEEDED');
    expect(
      recoveredAcrossReplica
        .json()
        .provider_attempts.map((attempt: { operation: string }) => attempt.operation),
    ).toEqual(['SUBMIT', 'STATUS_INQUIRY']);
    expect(
      recoveredAcrossReplica.json().timeline.map((event: { to_state: string }) => event.to_state),
    ).toEqual(['CREATED', 'RISK_EVALUATING', 'ALLOWED', 'SUBMITTED', 'PENDING', 'SUCCEEDED']);
  });

  it('persists a two-pulse reversal across replicas without a duplicate submission', async () => {
    const primary = apps[0]!;
    const replica = apps[1]!;
    const runId = `run_${randomUUID().replaceAll('-', '')}`;
    const payload = { run_id: runId };

    const pending = await primary.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/reversal-recovery/run',
      payload,
    });
    const reversalPending = await replica.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/reversal-recovery/recover',
      payload,
    });
    const reversed = await primary.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/reversal-recovery/recover',
      payload,
    });
    const terminalReplay = await replica.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/reversal-recovery/recover',
      payload,
    });

    expect(pending.statusCode).toBe(201);
    expect(pending.json()).toMatchObject({
      payment: { state: 'PENDING' },
      provider_attempts: [{ operation: 'SUBMIT', provider_status: 'PENDING' }],
    });
    expect(reversalPending.statusCode).toBe(200);
    expect(reversalPending.json()).toMatchObject({
      payment: { state: 'REVERSAL_PENDING' },
      recovery: {
        reversal_due_at: '2026-08-10T12:00:30.000Z',
        complaint_eligible_at: '2026-08-10T12:02:00.000Z',
      },
    });
    expect(reversed.statusCode).toBe(200);
    expect(reversed.json().payment.state).toBe('REVERSED');
    expect(
      reversed.json().provider_attempts.map((attempt: { operation: string }) => attempt.operation),
    ).toEqual(['SUBMIT', 'STATUS_INQUIRY', 'STATUS_INQUIRY']);
    expect(reversed.json().timeline.map((event: { to_state: string }) => event.to_state)).toEqual([
      'CREATED',
      'RISK_EVALUATING',
      'ALLOWED',
      'SUBMITTED',
      'PENDING',
      'REVERSAL_PENDING',
      'REVERSED',
    ]);
    expect(terminalReplay.statusCode).toBe(200);
    expect(terminalReplay.json().provider_attempts).toHaveLength(3);
  });

  it('persists a blocked refund case and its evidence across API replicas', async () => {
    const primary = apps[0]!;
    const replica = apps[1]!;
    const runId = `run_${randomUUID().replaceAll('-', '')}`;

    const blocked = await primary.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/refund-collect/run',
      payload: { run_id: runId },
    });
    expect(blocked.statusCode).toBe(201);
    expect(blocked.json()).toMatchObject({
      assessment: { decision: 'BLOCK' },
      payment: { state: 'BLOCKED', provider_request_ref: null },
      provider_attempts: [],
      fraud_case: { status: 'OPEN', severity: 'CRITICAL' },
    });

    const listed = await replica.inject({ method: 'GET', url: '/v1/demo/cases?limit=20' });
    expect(listed.statusCode).toBe(200);
    const persisted = listed
      .json()
      .cases.find(
        (fraudCase: { case_id: string }) => fraudCase.case_id === blocked.json().fraud_case.case_id,
      );
    if (!persisted) throw new Error('Refund fraud case was not visible on the second replica.');
    expect(persisted.evidence.map((item: { code: string }) => item.code)).toEqual([
      'REMOTE_ACCESS_ACTIVE',
      'REFUND_COLLECT_CONFLICT',
      'NEW_BENEFICIARY',
    ]);
    expect(persisted.timeline).toEqual([
      expect.objectContaining({ event_type: 'case.created', resource_version: 1 }),
    ]);
  });

  it('persists tenant-scoped two-hop graph evidence across API replicas', async () => {
    const primary = apps[0]!;
    const replica = apps[1]!;
    const runId = `run_${randomUUID().replaceAll('-', '')}`;

    const blocked = await primary.inject({
      method: 'POST',
      url: '/v1/demo/scenarios/mule-network/run',
      payload: { run_id: runId },
    });
    const paymentId = blocked.json().payment.payment_intent_id as string;
    const persisted = await replica.inject({
      method: 'GET',
      url: `/v1/demo/payments/${paymentId}`,
    });

    expect(blocked.statusCode).toBe(201);
    expect(blocked.json()).toMatchObject({
      assessment: { decision: 'BLOCK', reasons: [{ code: 'GRAPH_LINKED_DESTINATION' }] },
      payment: { state: 'BLOCKED' },
      provider_attempts: [],
      graph: {
        linked_confirmed_cases: 2,
        minimum_hops: 2,
        risk_contribution: 75,
        truncated: false,
      },
    });
    expect(persisted.statusCode).toBe(200);
    expect(persisted.json().graph.nodes).toHaveLength(6);
    expect(persisted.json().graph.edges).toHaveLength(5);
    expect(persisted.json().timeline.at(-1).evidence.graph).toMatchObject({
      destination_ref: 'vpa_tok_graph_destination_47',
      linked_confirmed_cases: 2,
      minimum_hops: 2,
    });
    expect(persisted.json().fraud_case).toMatchObject({
      category: 'RISK_REVIEW',
      evidence: [{ code: 'GRAPH_LINKED_DESTINATION', lens: 'INTEGRITY' }],
    });
  });
});
