import { apiEnvSchema } from '@trinetra/config';
import { Redis } from 'ioredis';
import {
  createDatabase,
  ensureTenant,
  PostgresCaseRepository,
  PostgresDeterministicPaymentProviderAdapter,
  PostgresPaymentLedgerRepository,
} from '@trinetra/database';
import { RedisNonceStore } from '@trinetra/security';

import { buildApp } from './app.js';

const env = apiEnvSchema.parse(process.env);
const { pool } = createDatabase(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
await ensureTenant(pool, {
  id: env.DEMO_TENANT_ID,
  slug: 'partner-demo',
  name: 'TRINETRA Synthetic Partner',
});
const app = await buildApp({
  partnerKey: env.DEMO_PARTNER_KEY,
  partnerSecret: env.DEMO_PARTNER_SECRET,
  logLevel: env.LOG_LEVEL,
  ledgerRepository: new PostgresPaymentLedgerRepository(pool),
  caseRepository: new PostgresCaseRepository(pool),
  paymentProvider: new PostgresDeterministicPaymentProviderAdapter(pool),
  nonceStore: new RedisNonceStore(redis),
  tenantId: env.DEMO_TENANT_ID,
  providerCallbackSecret: env.DEMO_PARTNER_SECRET,
  trustedDeviceTokens: [env.DEMO_TRUSTED_DEVICE_TOKEN],
  readinessChecks: {
    postgresql: async () => {
      await pool.query('select 1');
    },
    redis: async () => {
      if ((await redis.ping()) !== 'PONG') throw new Error('Redis ping failed');
    },
  },
  demoMode: env.DEMO_MODE,
  logger: true,
});
redis.on('error', (error) => app.log.error({ err: error }, 'Redis connection error'));
app.addHook('onClose', async () => {
  await Promise.allSettled([pool.end(), redis.quit()]);
});

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'TRINETRA API failed to start');
  process.exitCode = 1;
}
