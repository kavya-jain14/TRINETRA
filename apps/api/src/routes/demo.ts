import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { CaseRepository, CaseService, FraudCaseRecord } from '@trinetra/case-core';
import {
  DemoPaymentListSchema,
  DemoPaymentSnapshotSchema,
  DemoRecoveryRequestSchema,
  DemoRunRequestSchema,
  FraudCaseListSchema,
  FraudCaseSnapshotSchema,
  GraphRiskSnapshotSchema,
  PaymentResourceSchema,
  RiskAssessmentSchema,
  type DemoScenario,
  type PaymentIntentRequest,
} from '@trinetra/contracts';
import {
  type PaymentIntentRecord,
  type PaymentLedgerRepository,
  type PaymentLedgerService,
} from '@trinetra/payment-core';
import { syntheticMuleDestinationRef, type GraphRiskService } from '@trinetra/graph-core';
import { evaluatePaymentIntent } from '@trinetra/risk-core';
import { canonicalJson, sha256Hex } from '@trinetra/security';

const DemoPaymentParamsSchema = z.object({
  paymentId: z.string().startsWith('pi_demo_').max(96),
});
const DemoCaseParamsSchema = z.object({
  caseId: z.string().startsWith('case_demo_').max(104),
});
const DemoListQuerySchema = z.object({
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

const refundCollectIntent = {
  partner_customer_ref: 'cust_demo_104',
  direction: 'COLLECT',
  payment_type: 'P2P',
  amount_paise: 199_900,
  currency: 'INR',
  beneficiary: {
    vpa_token: 'vpa_tok_new_refund_agent',
    resolved_name: 'Synthetic Refund Desk',
  },
  context: {
    channel: 'UPI_COLLECT',
    device_token: 'dev_tok_trusted',
    session_ref: 'sess_demo_refund_collect',
    user_claimed_goal: 'RECEIVE_REFUND',
    remote_access_active: true,
  },
} as const satisfies PaymentIntentRequest;

const timeoutRecoveryIntent = {
  partner_customer_ref: 'cust_demo_104',
  direction: 'PUSH',
  payment_type: 'P2M',
  amount_paise: 78_600,
  currency: 'INR',
  beneficiary: {
    vpa_token: 'vpa_tok_metro_utilities_demo',
    resolved_name: 'Metro Utilities Demo',
  },
  merchant: {
    merchant_ref: 'm_demo_utility_07',
    expected_name: 'Metro Utilities Demo',
    mcc: '4900',
  },
  context: {
    channel: 'UPI_INTENT',
    device_token: 'dev_tok_trusted',
    session_ref: 'sess_demo_timeout_recovery',
    user_claimed_goal: 'PAY_MERCHANT',
    remote_access_active: false,
  },
} as const satisfies PaymentIntentRequest;

const reversalRecoveryIntent = {
  partner_customer_ref: 'cust_demo_104',
  direction: 'PUSH',
  payment_type: 'P2M',
  amount_paise: 42_500,
  currency: 'INR',
  beneficiary: {
    vpa_token: 'vpa_tok_harbor_cafe_demo',
    resolved_name: 'Harbor Cafe Demo',
  },
  merchant: {
    merchant_ref: 'm_demo_harbor_09',
    expected_name: 'Harbor Cafe Demo',
    mcc: '5812',
  },
  context: {
    channel: 'UPI_INTENT',
    device_token: 'dev_tok_trusted',
    session_ref: 'sess_demo_reversal_recovery',
    user_claimed_goal: 'PAY_MERCHANT',
    remote_access_active: false,
  },
} as const satisfies PaymentIntentRequest;

const muleNetworkIntent = {
  partner_customer_ref: 'cust_demo_104',
  direction: 'PUSH',
  payment_type: 'P2M',
  amount_paise: 64_900,
  currency: 'INR',
  beneficiary: {
    vpa_token: syntheticMuleDestinationRef,
    resolved_name: 'Orchid Supplies Demo',
  },
  merchant: {
    merchant_ref: 'm_demo_orchid_18',
    expected_name: 'Orchid Supplies Demo',
    mcc: '5999',
  },
  context: {
    channel: 'UPI_QR',
    device_token: 'dev_tok_trusted',
    session_ref: 'sess_demo_mule_network',
    user_claimed_goal: 'PAY_MERCHANT',
    remote_access_active: false,
  },
} as const satisfies PaymentIntentRequest;

const scenarios = {
  'trusted-payment': {
    key: 'trusted-payment',
    label: 'Trusted everyday payment',
    counterparty_name: 'Aarav Electronics',
    amount_paise: 24_900,
    direction: 'PUSH',
    claimed_goal: 'PAY_MERCHANT',
  },
  'refund-collect': {
    key: 'refund-collect',
    label: 'Deceptive refund collect request',
    counterparty_name: 'Synthetic Refund Desk',
    amount_paise: 199_900,
    direction: 'COLLECT',
    claimed_goal: 'RECEIVE_REFUND',
  },
  'timeout-recovery': {
    key: 'timeout-recovery',
    label: 'Provider timeout with safe recovery',
    counterparty_name: 'Metro Utilities Demo',
    amount_paise: 78_600,
    direction: 'PUSH',
    claimed_goal: 'PAY_MERCHANT',
  },
  'reversal-recovery': {
    key: 'reversal-recovery',
    label: 'Merchant confirmation missing with safe reversal',
    counterparty_name: 'Harbor Cafe Demo',
    amount_paise: 42_500,
    direction: 'PUSH',
    claimed_goal: 'PAY_MERCHANT',
  },
  'mule-network': {
    key: 'mule-network',
    label: 'Bounded mule-network proximity',
    counterparty_name: 'Orchid Supplies Demo',
    amount_paise: 64_900,
    direction: 'PUSH',
    claimed_goal: 'PAY_MERCHANT',
  },
} as const satisfies Readonly<Record<string, DemoScenario>>;

type ScenarioKey = keyof typeof scenarios;

export interface DemoRouteConfig {
  ledgerService: PaymentLedgerService;
  repository: PaymentLedgerRepository;
  caseService: CaseService;
  caseRepository: CaseRepository;
  graphService: GraphRiskService;
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

function minimizedRequest(input: PaymentIntentRequest) {
  return {
    partner_customer_ref: input.partner_customer_ref,
    direction: input.direction,
    payment_type: input.payment_type,
    amount_paise: input.amount_paise,
    currency: input.currency,
    beneficiary: { vpa_token: input.beneficiary.vpa_token },
    merchant: input.merchant
      ? {
          merchant_ref: input.merchant.merchant_ref,
          payee_name_matches_merchant: true,
          mcc: input.merchant.mcc,
        }
      : undefined,
    context: input.context,
  };
}

function scenarioKeyFor(payment: PaymentIntentRecord): ScenarioKey | null {
  if (payment.idempotencyKey.startsWith('demo:trusted-payment:')) return 'trusted-payment';
  if (payment.idempotencyKey.startsWith('demo:refund-collect:')) return 'refund-collect';
  if (payment.idempotencyKey.startsWith('demo:timeout-recovery:')) return 'timeout-recovery';
  if (payment.idempotencyKey.startsWith('demo:reversal-recovery:')) return 'reversal-recovery';
  if (payment.idempotencyKey.startsWith('demo:mule-network:')) return 'mule-network';
  return null;
}

async function caseSnapshot(repository: CaseRepository, fraudCase: FraudCaseRecord) {
  const timeline = await repository.listCaseEvents(fraudCase.tenantId, fraudCase.id);
  return FraudCaseSnapshotSchema.parse({
    case_id: fraudCase.id,
    payment_intent_id: fraudCase.paymentId,
    status: fraudCase.status,
    severity: fraudCase.severity,
    category: fraudCase.category,
    summary: fraudCase.summary,
    evidence: fraudCase.evidence,
    timeline: timeline.map((event) => ({
      event_id: event.id,
      event_type: event.eventType,
      source: event.source,
      payload: event.payload,
      resource_version: event.resourceVersion,
      occurred_at: event.occurredAt.toISOString(),
    })),
    resource_version: fraudCase.resourceVersion,
    opened_at: fraudCase.openedAt.toISOString(),
    updated_at: fraudCase.updatedAt.toISOString(),
  });
}

async function paymentSnapshot(config: DemoRouteConfig, payment: PaymentIntentRecord) {
  const scenarioKey = scenarioKeyFor(payment);
  if (!scenarioKey) throw new Error('Payment does not belong to a published demo scenario.');
  const [timeline, attempts, recovery, fraudCase] = await Promise.all([
    config.repository.listStateEvents(payment.tenantId, payment.id),
    config.repository.listProviderAttempts(payment.tenantId, payment.id),
    config.repository.getRecoveryClock(payment.tenantId, payment.id),
    config.caseRepository.getCaseByPayment(payment.tenantId, payment.id),
  ]);
  const graphEvidence = timeline.find(
    (event) => event.source === 'RISK_ENGINE' && 'graph' in event.evidence,
  )?.evidence.graph;
  const graph = graphEvidence ? GraphRiskSnapshotSchema.parse(graphEvidence) : null;

  return DemoPaymentSnapshotSchema.parse({
    scenario: scenarios[scenarioKey],
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
    recovery: recovery
      ? {
          status_check_due_at: recovery.statusCheckDueAt?.toISOString() ?? null,
          pending_expires_at: recovery.pendingExpiresAt?.toISOString() ?? null,
          reversal_due_at: recovery.reversalDueAt?.toISOString() ?? null,
          complaint_eligible_at: recovery.complaintEligibleAt?.toISOString() ?? null,
          resolved_at: recovery.resolvedAt?.toISOString() ?? null,
          updated_at: recovery.updatedAt.toISOString(),
        }
      : null,
    graph,
    fraud_case: fraudCase ? await caseSnapshot(config.caseRepository, fraudCase) : null,
  });
}

async function runScenario(config: DemoRouteConfig, scenarioKey: ScenarioKey, runId: string) {
  const intents: Readonly<Record<ScenarioKey, PaymentIntentRequest>> = {
    'trusted-payment': trustedPaymentIntent,
    'refund-collect': refundCollectIntent,
    'timeout-recovery': timeoutRecoveryIntent,
    'reversal-recovery': reversalRecoveryIntent,
    'mule-network': muleNetworkIntent,
  };
  const intent = intents[scenarioKey];
  const paymentId = paymentIdFor(`${scenarioKey}:${runId}`);
  if (scenarioKey === 'mule-network') {
    await config.graphService.ensureSyntheticMuleFixture(config.tenantId, config.now());
  }
  const graph = await config.graphService.assessDestination(
    config.tenantId,
    intent.beneficiary.vpa_token,
    config.now(),
  );
  const evaluated = RiskAssessmentSchema.parse(
    evaluatePaymentIntent(intent, {
      now: config.now(),
      paymentIntentId: paymentId,
      traceId: `tr_demo_${paymentId.slice('pi_demo_'.length)}`,
      deviceTrust: 'TRUSTED',
      beneficiaryTrust: scenarioKey === 'refund-collect' ? 'NEW' : 'KNOWN',
      ...(graph.risk_contribution > 0 || graph.truncated
        ? {
            graphRisk: {
              linkedConfirmedCases: graph.linked_confirmed_cases,
              minimumHops: graph.minimum_hops,
              contribution: graph.risk_contribution,
              truncated: graph.truncated,
            },
          }
        : {}),
    }),
  );
  const created = await config.ledgerService.createRiskEvaluatedPayment({
    paymentId,
    tenantId: config.tenantId,
    partnerCustomerRef: intent.partner_customer_ref,
    idempotencyKey: `demo:${scenarioKey}:${runId}`,
    requestHash: sha256Hex(canonicalJson(intent)),
    requestBody: minimizedRequest(intent),
    responseBody: evaluated,
    amountPaise: intent.amount_paise,
    currency: intent.currency,
    decision: evaluated.decision,
    ...(graph.risk_contribution > 0 || graph.truncated ? { decisionEvidence: { graph } } : {}),
  });

  const persistedAssessment = RiskAssessmentSchema.parse(created.responseBody);
  await config.caseService.ensureBlockedPaymentCase(
    config.tenantId,
    created.payment.id,
    persistedAssessment,
  );

  let payment = created.payment;
  if (
    scenarioKey !== 'refund-collect' &&
    scenarioKey !== 'mule-network' &&
    payment.state === 'ALLOWED'
  ) {
    const providerScenario =
      scenarioKey === 'trusted-payment'
        ? 'SUCCESS_IMMEDIATE'
        : scenarioKey === 'timeout-recovery'
          ? 'TIMEOUT_THEN_SUCCESS'
          : 'PENDING_THEN_REVERSED';
    const submitted = await config.ledgerService.submitPayment(
      config.tenantId,
      payment.id,
      providerScenario,
      {
        key: `demo-submit:${scenarioKey}:${runId}`,
        requestHash: sha256Hex(canonicalJson({ scenario: providerScenario })),
      },
    );
    payment = submitted.payment;
  }

  return {
    statusCode: created.outcome === 'CREATED' ? 201 : 200,
    snapshot: await paymentSnapshot(config, payment),
  } as const;
}

type RecoveryScenarioKey = 'timeout-recovery' | 'reversal-recovery';

async function recoverScenario(
  config: DemoRouteConfig,
  scenarioKey: RecoveryScenarioKey,
  runId: string,
) {
  const paymentId = paymentIdFor(`${scenarioKey}:${runId}`);
  let payment = await config.repository.getPayment(config.tenantId, paymentId);
  if (!payment || scenarioKeyFor(payment) !== scenarioKey) return null;

  if (
    payment.state === 'SUBMITTED' ||
    payment.state === 'PENDING' ||
    payment.state === 'REVERSAL_PENDING'
  ) {
    const recovered = await config.ledgerService.inquirePendingPayment(
      config.tenantId,
      payment.id,
      `demo-status-${payment.id.slice(-16)}-${payment.state.toLowerCase()}`,
    );
    payment = recovered.payment;
  }

  return await paymentSnapshot(config, payment);
}

function validationError(requestId: string, message: string) {
  return {
    error: {
      code: 'VALIDATION_FAILED',
      message,
      trace_id: `tr_${requestId}`,
    },
  } as const;
}

export async function registerDemoRoutes(
  app: FastifyInstance,
  config: DemoRouteConfig,
): Promise<void> {
  for (const scenarioKey of [
    'trusted-payment',
    'refund-collect',
    'timeout-recovery',
    'reversal-recovery',
    'mule-network',
  ] as const) {
    app.post(`/v1/demo/scenarios/${scenarioKey}/run`, async (request, reply) => {
      const parsed = DemoRunRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(validationError(request.id, 'Demo run identifier is invalid.'));
      }
      const result = await runScenario(config, scenarioKey, parsed.data.run_id);
      return reply.code(result.statusCode).send(result.snapshot);
    });
  }

  for (const scenarioKey of ['timeout-recovery', 'reversal-recovery'] as const) {
    app.post(`/v1/demo/scenarios/${scenarioKey}/recover`, async (request, reply) => {
      const parsed = DemoRecoveryRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(validationError(request.id, 'Demo recovery run identifier is invalid.'));
      }
      const snapshot = await recoverScenario(config, scenarioKey, parsed.data.run_id);
      if (!snapshot) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Run the ${scenarioKey} scenario before requesting a status check.`,
            trace_id: `tr_${request.id}`,
          },
        });
      }
      return reply.code(200).send(snapshot);
    });
  }

  app.get('/v1/demo/payments', async (request, reply) => {
    const parsed = DemoListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(validationError(request.id, 'Demo payment list query is invalid.'));
    }

    const payments = (await config.repository.listPayments(config.tenantId, 100))
      .filter((payment) => scenarioKeyFor(payment) !== null)
      .slice(0, parsed.data.limit);
    return DemoPaymentListSchema.parse({
      payments: await Promise.all(
        payments.map(async (payment) => await paymentSnapshot(config, payment)),
      ),
    });
  });

  app.get('/v1/demo/payments/:paymentId', async (request, reply) => {
    const parsed = DemoPaymentParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(validationError(request.id, 'Demo payment identifier is invalid.'));
    }
    const payment = await config.repository.getPayment(config.tenantId, parsed.data.paymentId);
    if (!payment || scenarioKeyFor(payment) === null) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Demo payment was not found.',
          trace_id: `tr_${request.id}`,
        },
      });
    }
    return await paymentSnapshot(config, payment);
  });

  app.get('/v1/demo/cases', async (request, reply) => {
    const parsed = DemoListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(validationError(request.id, 'Demo case list query is invalid.'));
    }
    const cases = (await config.caseRepository.listCases(config.tenantId, 100))
      .filter((fraudCase) => fraudCase.paymentId.startsWith('pi_demo_'))
      .slice(0, parsed.data.limit);
    return FraudCaseListSchema.parse({
      cases: await Promise.all(
        cases.map(async (fraudCase) => await caseSnapshot(config.caseRepository, fraudCase)),
      ),
    });
  });

  app.get('/v1/demo/cases/:caseId', async (request, reply) => {
    const parsed = DemoCaseParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(validationError(request.id, 'Demo case identifier is invalid.'));
    }
    const fraudCase = await config.caseRepository.getCase(config.tenantId, parsed.data.caseId);
    if (!fraudCase) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Demo fraud case was not found.',
          trace_id: `tr_${request.id}`,
        },
      });
    }
    return await caseSnapshot(config.caseRepository, fraudCase);
  });
}
