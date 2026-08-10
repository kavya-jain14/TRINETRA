import Fastify, { type FastifyInstance } from 'fastify';

import { openApiDocument } from '@trinetra/contracts';
import { createLoggerOptions } from '@trinetra/observability';
import { InMemoryNonceStore, type NonceStore } from '@trinetra/security';

import { registerHealthRoutes } from './routes/health.js';
import { registerPaymentIntentRoutes } from './routes/payment-intents.js';

export interface AppConfig {
  partnerKey: string;
  partnerSecret: string;
  logLevel?: string;
  now?: () => Date;
  nonceStore?: NonceStore;
  logger?: boolean;
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: config.logger ? createLoggerOptions(config.logLevel) : false,
    requestIdHeader: false,
  });

  const now = config.now ?? (() => new Date());
  const nonceStore = config.nonceStore ?? new InMemoryNonceStore();

  await registerHealthRoutes(app);
  app.get('/openapi.json', async () => openApiDocument);
  await registerPaymentIntentRoutes(app, {
    partnerKey: config.partnerKey,
    partnerSecret: config.partnerSecret,
    nonceStore,
    now,
    clockSkewSeconds: 300,
    idempotencyEntries: new Map(),
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        trace_id: `tr_${request.id}`,
      },
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, trace_id: `tr_${request.id}` }, 'Unhandled request error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The request could not be completed.',
        trace_id: `tr_${request.id}`,
      },
    });
  });

  return app;
}
