import { pspSandboxEnvSchema } from '@trinetra/config';

import { buildPspSandbox } from './app.js';

const env = pspSandboxEnvSchema.parse(process.env);
const app = await buildPspSandbox({
  callbackSecret: env.DEMO_PARTNER_SECRET,
  logger: true,
  logLevel: env.LOG_LEVEL,
});

try {
  await app.listen({ host: '0.0.0.0', port: env.PSP_SANDBOX_PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'TRINETRA PSP sandbox failed to start');
  process.exitCode = 1;
}
