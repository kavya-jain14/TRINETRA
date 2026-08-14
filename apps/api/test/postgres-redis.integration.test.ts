import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, ensureTenant, PostgresPaymentLedgerRepository } from '@trinetra/database';
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
      tenantId,
      trustedDeviceTokens: ['dev_tok_integration_trusted'],
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
});
