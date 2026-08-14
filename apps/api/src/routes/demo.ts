import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  DemoPaymentListSchema,
  DemoPaymentSnapshotSchema,
  DemoRunRequestSchema,
  PaymentResourceSchema,
  RiskAssessmentSchema,
  type PaymentIntentRequest,
} from '@trinetra/contracts';
import {
  type PaymentIntentRecord,
  type PaymentLedgerRepository,
  type PaymentLedgerService,
} from '@trinetra/payment-core';
import { evaluatePaymentIntent } from '@trinetra/risk-core';
import { canonicalJson, sha256Hex } from '@trinetra/security';

const DemoPaymentParamsSchema = z.object({
  paymentId: z.string().startsWith('pi_demo_').max(96),
});
const DemoPaymentListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

const trustedPaymentIntent = {
  partner_customer_ref: 'cust_demo_104',
  direction: 'PUSH',
  payment_type: 'P2M',
  amount_paise: 24_900,
  currency: 'INR',
  beneficiary: {
    vpa_token: 'vpa_tok_trusted_merchant',
    resolved_name: 'Aarav Electronics',
  },
  merchant: {
    merchant_ref: 'm_demo_12',
    expected_name: 'Aarav Electronics',
    mcc: '5732',
  },
  context: {
    channel: 'UPI_INTENT',
    device_token: 'dev_tok_trusted',
    session_ref: 'sess_demo_golden_flow',
    user_claimed_goal: 'PAY_MERCHANT',
    remote_access_active: false,
  },
} as const satisfies PaymentIntentRequest;

const scenario = {
  key: 'trusted-payment',
  label: 'Trusted everyday payment',
  merchant_name: 'Aarav Electronics',
  amount_paise: 24_900,
} as const;

export interface DemoRouteConfig {
  ledgerService: PaymentLedgerService;
  repository: PaymentLedgerRepository;
  tenantId: string;
  now: () => Date;
}

function paymentIdFor(runId: string): string {
  const digest = createHash('sha256').update(runId, 'utf8').digest('hex').slice(0, 32);
  return `pi_demo_${digest}`;
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

async function paymentSnapshot(repository: PaymentLedgerRepository, payment: PaymentIntentRecord) {
  const [timeline, attempts] = await Promise.all([
    repository.listStateEvents(payment.tenantId, payment.id),
    repository.listProviderAttempts(payment.tenantId, payment.id),
  ]);

  return DemoPaymentSnapshotSchema.parse({
    scenario,
    assessment: RiskAssessmentSchema.parse(payment.responseBody),
    payment: paymentResource(payment),
    timeline: timeline.map((event) => ({
      event_id: event.id,
      from_state: event.fromState,
      to_state: event.toState,
      source: event.source,
      evidence: event.evidence,
      resource_version: event.resourceVersion,
      occurred_at: event.occurredAt.toISOString(),
    })),
    provider_attempts: attempts.map((attempt) => ({
      attempt_id: attempt.id,
      operation: attempt.operation,
      status: attempt.status,
      provider_status: attempt.providerStatus,
      response_code: attempt.responseCode,
      created_at: attempt.createdAt.toISOString(),
      completed_at: attempt.completedAt?.toISOString() ?? null,
    })),
  });
}

export async function registerDemoRoutes(
  app: FastifyInstance,
  config: DemoRouteConfig,
): Promise<void> {
  app.post('/v1/demo/scenarios/trusted-payment/run', async (request, reply) => {
    const parsed = DemoRunRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Demo run identifier is invalid.',
          trace_id: `tr_${request.id}`,
        },
      });
    }

    const paymentId = paymentIdFor(parsed.data.run_id);
    const assessment = RiskAssessmentSchema.parse(
      evaluatePaymentIntent(trustedPaymentIntent, {
        now: config.now(),
        paymentIntentId: paymentId,
        traceId: `tr_demo_${paymentId.slice('pi_demo_'.length)}`,
        deviceTrust: 'TRUSTED',
      }),
    );
    const created = await config.ledgerService.createRiskEvaluatedPayment({
      paymentId,
      tenantId: config.tenantId,
      partnerCustomerRef: trustedPaymentIntent.partner_customer_ref,
      idempotencyKey: `demo:trusted-payment:${parsed.data.run_id}`,
      requestHash: sha256Hex(canonicalJson(trustedPaymentIntent)),
      requestBody: {
        partner_customer_ref: trustedPaymentIntent.partner_customer_ref,
        direction: trustedPaymentIntent.direction,
        payment_type: trustedPaymentIntent.payment_type,
        amount_paise: trustedPaymentIntent.amount_paise,
        currency: trustedPaymentIntent.currency,
        beneficiary: { vpa_token: trustedPaymentIntent.beneficiary.vpa_token },
        merchant: {
          merchant_ref: trustedPaymentIntent.merchant.merchant_ref,
          payee_name_matches_merchant: true,
          mcc: trustedPaymentIntent.merchant.mcc,
        },
        context: trustedPaymentIntent.context,
      },
      responseBody: assessment,
      amountPaise: trustedPaymentIntent.amount_paise,
      currency: trustedPaymentIntent.currency,
      decision: assessment.decision,
    });

    let payment = created.payment;
    if (payment.state === 'ALLOWED') {
      const submitted = await config.ledgerService.submitPayment(
        config.tenantId,
        payment.id,
        'SUCCESS_IMMEDIATE',
        {
          key: `demo-submit:${parsed.data.run_id}`,
          requestHash: sha256Hex(canonicalJson({ scenario: 'SUCCESS_IMMEDIATE' })),
        },
      );
      payment = submitted.payment;
    }

    return reply
      .code(created.outcome === 'CREATED' ? 201 : 200)
      .send(await paymentSnapshot(config.repository, payment));
  });

  app.get('/v1/demo/payments', async (request, reply) => {
    const parsed = DemoPaymentListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Demo payment list query is invalid.',
          trace_id: `tr_${request.id}`,
        },
      });
    }

    const payments = (await config.repository.listPayments(config.tenantId, 100))
      .filter((payment) => payment.idempotencyKey.startsWith('demo:trusted-payment:'))
      .slice(0, parsed.data.limit);
    return DemoPaymentListSchema.parse({
      payments: await Promise.all(
        payments.map(async (payment) => await paymentSnapshot(config.repository, payment)),
      ),
    });
  });

  app.get('/v1/demo/payments/:paymentId', async (request, reply) => {
    const parsed = DemoPaymentParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Demo payment identifier is invalid.',
          trace_id: `tr_${request.id}`,
        },
      });
    }
    const payment = await config.repository.getPayment(config.tenantId, parsed.data.paymentId);
    if (!payment || !payment.idempotencyKey.startsWith('demo:trusted-payment:')) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Demo payment was not found.',
          trace_id: `tr_${request.id}`,
        },
      });
    }
    return await paymentSnapshot(config.repository, payment);
  });
}
