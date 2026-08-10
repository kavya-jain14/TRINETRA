import { createHash, randomUUID } from 'node:crypto';

import type {
  PaymentState,
  ProviderCallback,
  ProviderScenario,
  RiskDecision,
} from '@trinetra/contracts';

import {
  PaymentNotFoundError,
  type ApplyProviderEventInput,
  type CreatePaymentResult,
  type PaymentIntentRecord,
  type PaymentLedgerRepository,
  type ProviderEventResult,
} from './ledger.js';
import type { PaymentProviderAdapter } from './provider.js';

export interface CreateRiskEvaluatedPaymentInput {
  paymentId: string;
  tenantId: string;
  partnerCustomerRef: string;
  idempotencyKey: string;
  requestHash: string;
  requestBody: unknown;
  responseBody: unknown;
  amountPaise: number;
  currency: 'INR';
  decision: RiskDecision;
}

export interface PaymentLedgerServiceConfig {
  repository: PaymentLedgerRepository;
  provider: PaymentProviderAdapter;
  now?: () => Date;
  idFactory?: () => string;
}

function stateForDecision(decision: RiskDecision): PaymentState {
  if (decision === 'ALLOW') return 'ALLOWED';
  if (decision === 'BLOCK') return 'BLOCKED';
  return 'CHALLENGED';
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function redactPII(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body;
  const clone = structuredClone(body) as Record<string, unknown>;

  if (clone.beneficiary && typeof clone.beneficiary === 'object') {
    const ben = clone.beneficiary as Record<string, unknown>;
    if ('resolved_name' in ben) ben.resolved_name = '[REDACTED]';
  }
  if (clone.merchant && typeof clone.merchant === 'object') {
    const mer = clone.merchant as Record<string, unknown>;
    if ('expected_name' in mer) mer.expected_name = '[REDACTED]';
  }

  return clone;
}

export class PaymentLedgerService {
  readonly #repository: PaymentLedgerRepository;
  readonly #provider: PaymentProviderAdapter;
  readonly #now: () => Date;
  readonly #idFactory: () => string;

  constructor(config: PaymentLedgerServiceConfig) {
    this.#repository = config.repository;
    this.#provider = config.provider;
    this.#now = config.now ?? (() => new Date());
    this.#idFactory = config.idFactory ?? (() => randomUUID().replaceAll('-', ''));
  }

  async createRiskEvaluatedPayment(
    input: CreateRiskEvaluatedPaymentInput,
  ): Promise<CreatePaymentResult> {
    const now = this.#now();
    const redactedRequest = redactPII(input.requestBody);
    const created = await this.#repository.createPayment({
      ...input,
      requestBody: redactedRequest,
      now,
    });
    if (created.outcome === 'REPLAY') return created;

    await this.#repository.transitionPayment({
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      toState: 'RISK_EVALUATING',
      eventKey: `${input.paymentId}:risk-evaluating`,
      source: 'RISK_ENGINE',
      now,
    });
    const payment = await this.#repository.transitionPayment({
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      toState: stateForDecision(input.decision),
      eventKey: `${input.paymentId}:risk-decision:${input.decision}`,
      source: 'RISK_ENGINE',
      evidence: { decision: input.decision },
      now,
    });
    return { ...created, payment };
  }

  async submitPayment(
    tenantId: string,
    paymentId: string,
    scenario: ProviderScenario,
    idempotencyKey: string,
  ): Promise<ProviderEventResult> {
    const payment = await this.#requirePayment(tenantId, paymentId);
    const requestReference = `psp_${paymentId.slice(3)}`;
    const attemptId = `pa_${this.#idFactory()}`;
    const prepared = await this.#repository.prepareProviderAttempt({
      id: attemptId,
      tenantId,
      paymentId,
      provider: this.#provider.name,
      operation: 'SUBMIT',
      requestReference,
      requestHash: digest(`${paymentId}:${payment.amountPaise}:${scenario}:${idempotencyKey}`),
      eventKey: `${paymentId}:submitted`,
      now: this.#now(),
    });

    if (!prepared.created) return { outcome: 'DUPLICATE', payment: prepared.payment };

    try {
      const result = await this.#provider.submit({
        paymentId,
        requestReference,
        amountPaise: payment.amountPaise,
        scenario,
      });
      return await this.#repository.completeProviderAttempt({
        tenantId,
        attemptId,
        providerStatus: result.providerStatus,
        responseCode: result.responseCode,
        evidence: result.evidence,
        now: this.#now(),
      });
    } catch {
      return await this.#repository.completeProviderAttempt({
        tenantId,
        attemptId,
        providerStatus: 'PENDING',
        responseCode: 'TIMEOUT_UNKNOWN',
        evidence: { recovery: 'STATUS_FIRST' },
        now: this.#now(),
      });
    }
  }

  async inquirePendingPayment(
    tenantId: string,
    paymentId: string,
    recoveryKey: string,
  ): Promise<ProviderEventResult> {
    const payment = await this.#requirePayment(tenantId, paymentId);
    if (!payment.providerRequestReference) {
      throw new Error(`Payment ${paymentId} has no provider request reference.`);
    }

    const attemptId = `pa_${this.#idFactory()}`;
    const requestReference = `status_${paymentId.slice(3)}_${recoveryKey}`;
    const prepared = await this.#repository.prepareProviderAttempt({
      id: attemptId,
      tenantId,
      paymentId,
      provider: this.#provider.name,
      operation: 'STATUS_INQUIRY',
      requestReference,
      requestHash: digest(`${paymentId}:${recoveryKey}`),
      eventKey: `${paymentId}:status-inquiry:${recoveryKey}`,
      now: this.#now(),
    });
    if (!prepared.created) return { outcome: 'DUPLICATE', payment: prepared.payment };

    try {
      const result = await this.#provider.inquire({
        paymentId,
        requestReference,
        providerRequestReference: payment.providerRequestReference,
      });
      return await this.#repository.completeProviderAttempt({
        tenantId,
        attemptId,
        providerStatus: result.providerStatus,
        responseCode: result.responseCode,
        evidence: result.evidence,
        now: this.#now(),
      });
    } catch {
      return await this.#repository.completeProviderAttempt({
        tenantId,
        attemptId,
        providerStatus: 'PENDING',
        responseCode: 'TIMEOUT_UNKNOWN',
        evidence: { recovery: 'STATUS_FIRST' },
        now: this.#now(),
      });
    }
  }

  async applyProviderCallback(
    tenantId: string,
    callback: ProviderCallback,
    payloadHash: string,
    receivedAt = this.#now(),
  ): Promise<ProviderEventResult> {
    const input: ApplyProviderEventInput = {
      id: `pve_${this.#idFactory()}`,
      tenantId,
      paymentId: callback.payment_id,
      provider: this.#provider.name,
      providerEventId: callback.event_id,
      providerReference: callback.provider_ref,
      providerStatus: callback.status,
      payloadHash,
      amountPaise: callback.amount_paise,
      occurredAt: new Date(callback.occurred_at),
      receivedAt,
    };
    return await this.#repository.applyProviderEvent(input);
  }

  async getPayment(tenantId: string, paymentId: string): Promise<PaymentIntentRecord | null> {
    return await this.#repository.getPayment(tenantId, paymentId);
  }

  async #requirePayment(tenantId: string, paymentId: string): Promise<PaymentIntentRecord> {
    const payment = await this.#repository.getPayment(tenantId, paymentId);
    if (!payment) throw new PaymentNotFoundError(paymentId);
    return payment;
  }
}
