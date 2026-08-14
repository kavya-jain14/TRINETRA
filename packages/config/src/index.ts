import { z } from 'zod';

const commonEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const webhookUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    },
    { message: 'Webhook URL must use HTTP or HTTPS.' },
  );

export const apiEnvSchema = commonEnvSchema
  .extend({
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DEMO_PARTNER_KEY: z.string().min(3).default('partner_demo'),
    DEMO_PARTNER_SECRET: z.string().min(32),
    DEMO_TENANT_ID: z.uuid().default('00000000-0000-4000-8000-000000000001'),
    DEMO_TRUSTED_DEVICE_TOKEN: z.string().min(8).default('dev_tok_trusted'),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && env.DEMO_MODE) {
      context.addIssue({
        code: 'custom',
        path: ['DEMO_MODE'],
        message: 'Demo scenario routes must be disabled in production.',
      });
    }
  });
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = commonEnvSchema
  .extend({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    PARTNER_WEBHOOK_URL: webhookUrlSchema.default('http://127.0.0.1:4100/v1/partner-events'),
    WEBHOOK_DELIVERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),
    DEMO_PARTNER_SECRET: z.string().min(32),
    DEMO_TENANT_ID: z.uuid().default('00000000-0000-4000-8000-000000000001'),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && new URL(env.PARTNER_WEBHOOK_URL).protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['PARTNER_WEBHOOK_URL'],
        message: 'Production partner webhooks require HTTPS.',
      });
    }
  });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const pspSandboxEnvSchema = commonEnvSchema.extend({
  PSP_SANDBOX_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  DEMO_PARTNER_SECRET: z.string().min(32),
});
export type PspSandboxEnv = z.infer<typeof pspSandboxEnvSchema>;
