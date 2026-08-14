import Fastify, { type FastifyInstance } from 'fastify';

import { openApiDocument } from '@trinetra/contracts';
import { createLoggerOptions } from '@trinetra/observability';
import {
  DeterministicPaymentProviderAdapter,
  InMemoryPaymentLedgerRepository,
  PaymentLedgerService,
  type PaymentLedgerRepository,
  type PaymentProviderAdapter,
} from '@trinetra/payment-core';
import { InMemoryNonceStore, type NonceStore } from '@trinetra/security';

import { registerHealthRoutes } from './routes/health.js';
import { registerPaymentIntentRoutes } from './routes/payment-intents.js';
import { registerPaymentOperationRoutes } from './routes/payment-operations.js';

const defaultTenantId = '00000000-0000-4000-8000-000000000001';

export interface AppConfig {
  partnerKey: string;
  partnerSecret: string;
  logLevel?: string;
  now?: () => Date;
  nonceStore?: NonceStore;
  ledgerRepository?: PaymentLedgerRepository;
  paymentProvider?: PaymentProviderAdapter;
  tenantId?: string;
  providerCallbackSecret?: string;
  trustedDeviceTokens?: readonly string[];
  readinessChecks?: Readonly<Record<string, () => Promise<void>>>;
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
  const provider = config.paymentProvider ?? new DeterministicPaymentProviderAdapter();
  const ledgerService = new PaymentLedgerService({
    repository: config.ledgerRepository ?? new InMemoryPaymentLedgerRepository(),
    provider,
    now,
  });
  const tenantId = config.tenantId ?? defaultTenantId;
  const trustedDeviceTokens = new Set(config.trustedDeviceTokens ?? ['dev_tok_trusted']);

  await registerHealthRoutes(app, {
    persistence: config.ledgerRepository ? 'postgresql' : 'in-memory-test-adapter',
    ...(config.readinessChecks ? { checks: config.readinessChecks } : {}),
  });
  app.get('/openapi.json', async () => openApiDocument);
  await registerPaymentIntentRoutes(app, {
    partnerKey: config.partnerKey,
    partnerSecret: config.partnerSecret,
    nonceStore,
    now,
    clockSkewSeconds: 300,
    ledgerService,
    tenantId,
    isTrustedDeviceToken: (deviceToken) => trustedDeviceTokens.has(deviceToken),
  });
  await registerPaymentOperationRoutes(app, {
    partnerKey: config.partnerKey,
    partnerSecret: config.partnerSecret,
    providerCallbackSecret: config.providerCallbackSecret ?? config.partnerSecret,
    nonceStore,
    now,
    clockSkewSeconds: 300,
    ledgerService,
    tenantId,
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
