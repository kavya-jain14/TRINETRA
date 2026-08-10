import { apiEnvSchema } from '@trinetra/config';
import { createDatabase, ensureTenant, PostgresPaymentLedgerRepository } from '@trinetra/database';
import { HttpPaymentProviderAdapter } from '@trinetra/payment-core';

import { buildApp } from './app.js';

const env = apiEnvSchema.parse(process.env);
const { pool } = createDatabase(env.DATABASE_URL);
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
  paymentProvider: new HttpPaymentProviderAdapter(
    process.env.PSP_SANDBOX_URL ?? 'http://localhost:3002',
  ),
  tenantId: env.DEMO_TENANT_ID,
  providerCallbackSecret: env.DEMO_PARTNER_SECRET,
  logger: true,
});
app.addHook('onClose', async () => await pool.end());

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'TRINETRA API failed to start');
  process.exitCode = 1;
}
