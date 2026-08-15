import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import type { CaseService } from '@trinetra/case-core';
import {
  PaymentIntentRequestSchema,
  RiskAssessmentSchema,
  type PaymentIntentRequest,
} from '@trinetra/contracts';
import {
  IdempotencyConflictError,
  type CreatePaymentResult,
  type PaymentLedgerService,
} from '@trinetra/payment-core';
import { evaluatePaymentIntent, normalizePaymentPartyName } from '@trinetra/risk-core';

import { authenticatePartnerRequest, type PartnerAuthConfig } from '../auth.js';

export interface PaymentIntentRouteConfig extends PartnerAuthConfig {
  ledgerService: PaymentLedgerService;
  caseService: CaseService;
  tenantId: string;
  isTrustedDeviceToken: (deviceToken: string) => boolean;
}

function privacyMinimizedRequest(input: PaymentIntentRequest) {
  return {
    partner_customer_ref: input.partner_customer_ref,
    direction: input.direction,
    payment_type: input.payment_type,
    amount_paise: input.amount_paise,
    currency: input.currency,
    beneficiary: {
      vpa_token: input.beneficiary.vpa_token,
    },
    merchant: input.merchant
      ? {
          merchant_ref: input.merchant.merchant_ref,
          payee_name_matches_merchant:
            normalizePaymentPartyName(input.merchant.expected_name) ===
            normalizePaymentPartyName(input.beneficiary.resolved_name),
          mcc: input.merchant.mcc,
        }
      : undefined,
    context: input.context,
  };
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

    const opaqueId = randomUUID().replaceAll('-', '');
    const paymentIntentId = `pi_${opaqueId}`;
    const evaluated = RiskAssessmentSchema.parse(
      evaluatePaymentIntent(parsed.data, {
        now: config.now(),
        paymentIntentId,
        traceId: `tr_${request.id}`,
        deviceTrust: config.isTrustedDeviceToken(parsed.data.context.device_token)
          ? 'TRUSTED'
          : 'UNKNOWN',
      }),
    );

    let result: CreatePaymentResult;
    try {
      result = await config.ledgerService.createRiskEvaluatedPayment({
        paymentId: paymentIntentId,
        tenantId: config.tenantId,
        partnerCustomerRef: parsed.data.partner_customer_ref,
        idempotencyKey: authentication.idempotencyKey,
        requestHash: authentication.requestHash,
        requestBody: privacyMinimizedRequest(parsed.data),
        responseBody: evaluated,
        amountPaise: parsed.data.amount_paise,
        currency: parsed.data.currency,
        decision: evaluated.decision,
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'The idempotency key is already bound to a different request body.',
            trace_id: `tr_${request.id}`,
          },
        });
      }
      throw error;
    }

    const response = RiskAssessmentSchema.parse(result.responseBody);
    await config.caseService.ensureBlockedPaymentCase(config.tenantId, result.payment.id, response);

    reply.header('x-trace-id', response.trace_id);
    reply.header('x-resource-version', response.resource_version);
    return reply.code(result.outcome === 'CREATED' ? 201 : 200).send(response);
  });
}
