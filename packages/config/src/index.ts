import { z } from 'zod';

const commonEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const apiEnvSchema = commonEnvSchema.extend({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DEMO_PARTNER_KEY: z.string().min(3).default('partner_demo'),
  DEMO_PARTNER_SECRET: z.string().min(32),
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = commonEnvSchema.extend({
  REDIS_URL: z.string().url(),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const pspSandboxEnvSchema = commonEnvSchema.extend({
  PSP_SANDBOX_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  DEMO_PARTNER_SECRET: z.string().min(32),
});
export type PspSandboxEnv = z.infer<typeof pspSandboxEnvSchema>;
