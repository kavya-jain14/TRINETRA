import { apiEnvSchema } from '@trinetra/config';

import { buildApp } from './app.js';

const env = apiEnvSchema.parse(process.env);
const app = await buildApp({
  partnerKey: env.DEMO_PARTNER_KEY,
  partnerSecret: env.DEMO_PARTNER_SECRET,
  logLevel: env.LOG_LEVEL,
  logger: true,
});

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'TRINETRA API failed to start');
  process.exitCode = 1;
}
