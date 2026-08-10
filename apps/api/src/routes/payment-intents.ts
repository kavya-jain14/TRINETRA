import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import {
  PaymentIntentRequestSchema,
  RiskAssessmentSchema,
  type RiskAssessment,
} from '@trinetra/contracts';
import { evaluatePaymentIntent } from '@trinetra/risk-core';

import { authenticatePartnerRequest, type PartnerAuthConfig } from '../auth.js';

interface IdempotencyEntry {
  requestHash: string;
  response: RiskAssessment;
}

export interface PaymentIntentRouteConfig extends PartnerAuthConfig {
  idempotencyEntries: Map<string, IdempotencyEntry>;
}

export async function registerPaymentIntentRoutes(
  app: FastifyInstance,
  config: PaymentIntentRouteConfig,
): Promise<void> {
  app.post('/v1/payment-intents', async (request, reply) => {
    const authentication = await authenticatePartnerRequest(request, reply, config);
    if (!authentication) return;

    const parsed = PaymentIntentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Payment intent does not match the published contract.',
          trace_id: `tr_${request.id}`,
          details: { issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      });
    }

    const idempotencyScope = `${authentication.partnerKey}:payment-intents:${authentication.idempotencyKey}`;
    const existing = config.idempotencyEntries.get(idempotencyScope);
    if (existing) {
      if (existing.requestHash !== authentication.requestHash) {
        return reply.code(409).send({
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'The idempotency key is already bound to a different request body.',
            trace_id: `tr_${request.id}`,
          },
        });
      }

      reply.header('x-trace-id', existing.response.trace_id);
      reply.header('x-resource-version', existing.response.resource_version);
      return reply.code(200).send(existing.response);
    }

    const opaqueId = randomUUID().replaceAll('-', '');
    const response = RiskAssessmentSchema.parse(
      evaluatePaymentIntent(parsed.data, {
        now: config.now(),
        paymentIntentId: `pi_${opaqueId}`,
        traceId: `tr_${request.id}`,
      }),
    );
    config.idempotencyEntries.set(idempotencyScope, {
      requestHash: authentication.requestHash,
      response,
    });

    reply.header('x-trace-id', response.trace_id);
    reply.header('x-resource-version', response.resource_version);
    return reply.code(201).send(response);
  });
}
