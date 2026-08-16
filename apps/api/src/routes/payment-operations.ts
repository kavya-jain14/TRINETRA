import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  PaymentResourceSchema,
  PaymentOperationResultSchema,
  PaymentSubmissionRequestSchema,
  ProviderCallbackAckSchema,
  ProviderCallbackSchema,
} from '@trinetra/contracts';
import {
  IllegalPaymentTransitionError,
  IdempotencyConflictError,
  PaymentNotFoundError,
  ProviderPayloadMismatchError,
  type PaymentIntentRecord,
  type PaymentLedgerService,
} from '@trinetra/payment-core';

import {
  authenticatePartnerRequest,
  authenticateProviderCallback,
  type PartnerAuthConfig,
} from '../auth.js';

const PaymentParamsSchema = z.object({ paymentId: z.string().startsWith('pi_').max(96) });

export interface PaymentOperationRouteConfig extends PartnerAuthConfig {
  ledgerService: PaymentLedgerService;
  tenantId: string;
  providerCallbackSecret: string;
}

function paymentResource(payment: PaymentIntentRecord) {
  return PaymentResourceSchema.parse({
    payment_intent_id: payment.id,
    state: payment.state,
    provider_request_ref: payment.providerRequestReference,
    resource_version: payment.resourceVersion,
    updated_at: payment.updatedAt.toISOString(),
  });
}

export async function registerPaymentOperationRoutes(
  app: FastifyInstance,
  config: PaymentOperationRouteConfig,
): Promise<void> {
  app.post('/v1/payment-intents/:paymentId/submit', async (request, reply) => {
    const authentication = await authenticatePartnerRequest(request, reply, config);
    if (!authentication) return;
    const params = PaymentParamsSchema.safeParse(request.params);
    const body = PaymentSubmissionRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Payment submission does not match the published contract.',
          trace_id: `tr_${request.id}`,
        },
      });
    }

    try {
      const result = await config.ledgerService.submitPayment(
        config.tenantId,
        params.data.paymentId,
        body.data.scenario,
        { key: authentication.idempotencyKey, requestHash: authentication.requestHash },
      );
      return reply.code(result.outcome === 'DUPLICATE' ? 200 : 202).send(
        PaymentOperationResultSchema.parse({
          outcome: result.outcome,
          payment: paymentResource(result.payment),
        }),
      );
    } catch (error) {
      if (error instanceof PaymentNotFoundError) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Payment intent was not found.',
            trace_id: `tr_${request.id}`,
          },
        });
      }
      if (error instanceof IllegalPaymentTransitionError) {
        return reply.code(409).send({
          error: {
            code: 'ILLEGAL_STATE_TRANSITION',
            message: 'Payment state does not allow provider submission.',
            trace_id: `tr_${request.id}`,
          },
        });
      }
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'The idempotency key is already bound to a different submission.',
            trace_id: `tr_${request.id}`,
          },
        });
      }
      throw error;
    }
  });

  app.post('/v1/provider-events/trinetra-sandbox', async (request, reply) => {
    const authentication = authenticateProviderCallback(request, reply, {
      providerSecret: config.providerCallbackSecret,
      now: config.now,
      clockSkewSeconds: config.clockSkewSeconds,
    });
    if (!authentication) return;
    const callback = ProviderCallbackSchema.safeParse(request.body);
    if (!callback.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Provider event does not match the published contract.',
          trace_id: `tr_${request.id}`,
        },
      });
    }

    try {
      const result = await config.ledgerService.applyProviderCallback(
        config.tenantId,
        callback.data,
        authentication.requestHash,
      );
      return reply.code(202).send(
        ProviderCallbackAckSchema.parse({
          event_id: callback.data.event_id,
          outcome: result.outcome,
          payment: paymentResource(result.payment),
        }),
      );
    } catch (error) {
      if (error instanceof PaymentNotFoundError) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Provider event references an unknown payment.',
            trace_id: `tr_${request.id}`,
          },
        });
      }
      if (error instanceof ProviderPayloadMismatchError) {
        return reply.code(409).send({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Provider event does not match the payment or prior event.',
            trace_id: `tr_${request.id}`,
          },
        });
      }
      throw error;
    }
  });
}
