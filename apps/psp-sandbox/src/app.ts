import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ProviderCallbackSchema, ProviderScenarioSchema } from '@trinetra/contracts';
import { createLoggerOptions } from '@trinetra/observability';
import { canonicalJson, signPartnerRequest } from '@trinetra/security';

const SimulatorRequestSchema = z.object({
  payment_id: z.string().startsWith('pi_').max(96),
  amount_paise: z.number().int().positive(),
  scenario: ProviderScenarioSchema.default('SUCCESS_IMMEDIATE'),
});

const initialStatus = {
  SUCCESS_IMMEDIATE: 'SUCCEEDED',
  PENDING_THEN_SUCCESS: 'PENDING',
  PENDING_THEN_REVERSED: 'PENDING',
  SOFT_DECLINE: 'FAILED_SOFT',
  HARD_DECLINE: 'FAILED_HARD',
  TIMEOUT_UNKNOWN: 'PENDING',
  DUPLICATE_CALLBACK: 'SUCCEEDED',
  OUT_OF_ORDER_CALLBACK: 'SUCCEEDED',
  INVALID_SIGNATURE_CALLBACK: 'SUCCEEDED',
} as const;

interface SyntheticPayment {
  scenario: string;
  inquiryCount: number;
}
const sandboxState = new Map<string, SyntheticPayment>();

export interface PspSandboxConfig {
  callbackSecret: string;
  now?: () => Date;
  logger?: boolean;
  logLevel?: string;
}

export async function buildPspSandbox(config: PspSandboxConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logger ? createLoggerOptions(config.logLevel) : false,
  });
  const now = config.now ?? (() => new Date());

  app.get('/health/live', async () => ({ status: 'ok', service: 'trinetra-psp-sandbox' }));

  app.post('/v1/simulate', async (request, reply) => {
    const parsed = SimulatorRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_FAILED', message: 'Invalid deterministic PSP scenario.' },
      });
    }

    const providerReference = `psp_${parsed.data.payment_id.slice(3)}`;
    sandboxState.set(providerReference, { scenario: parsed.data.scenario, inquiryCount: 0 });

    const eventId = `pe_${randomUUID().replaceAll('-', '')}`;
    const providerEvent = ProviderCallbackSchema.parse({
      event_id: eventId,
      payment_id: parsed.data.payment_id,
      provider_ref: providerReference,
      status: initialStatus[parsed.data.scenario],
      amount_paise: parsed.data.amount_paise,
      occurred_at: now().toISOString(),
    });
    const body = canonicalJson(providerEvent);
    const timestamp = String(Math.floor(now().getTime() / 1000));
    const callbackPath = '/v1/provider-events/trinetra-sandbox';
    let signature = signPartnerRequest(config.callbackSecret, {
      method: 'POST',
      path: callbackPath,
      timestamp,
      nonce: eventId,
      body,
    });
    if (parsed.data.scenario === 'INVALID_SIGNATURE_CALLBACK') signature = '0'.repeat(64);

    return reply.code(200).send({
      scenario: parsed.data.scenario,
      provider_event: providerEvent,
      callback: {
        path: callbackPath,
        headers: {
          'x-timestamp': timestamp,
          'x-nonce': eventId,
          'x-signature': signature,
        },
      },
    });
  });

  app.post('/v1/inquire', async (request, reply) => {
    const { providerRequestReference, requestReference } = request.body as {
      providerRequestReference: string;
      requestReference: string;
    };
    const payment = sandboxState.get(providerRequestReference);
    if (!payment) {
      return reply.code(200).send({
        providerStatus: 'PENDING',
        responseCode: 'UNKNOWN_REFERENCE',
        providerReference: providerRequestReference,
        evidence: { inquiry_request_ref: requestReference },
      });
    }

    payment.inquiryCount += 1;
    let providerStatus: string = initialStatus[payment.scenario as keyof typeof initialStatus];
    if (payment.scenario === 'PENDING_THEN_SUCCESS') providerStatus = 'SUCCEEDED';
    if (payment.scenario === 'PENDING_THEN_REVERSED') {
      providerStatus = payment.inquiryCount === 1 ? 'REVERSAL_PENDING' : 'REVERSED';
    }

    return reply.code(200).send({
      providerStatus,
      responseCode: 'SYNTHETIC_STATUS',
      providerReference: providerRequestReference,
      evidence: {
        inquiry_request_ref: requestReference,
        inquiry_number: payment.inquiryCount,
      },
    });
  });

  return app;
}
