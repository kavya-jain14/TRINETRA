import type { PaymentState } from '@trinetra/contracts';

import { assertPaymentTransition, canTransitionPayment } from './state-machine.js';
import {
  IdempotencyConflictError,
  PaymentNotFoundError,
  ProviderPayloadMismatchError,
  type ApplyProviderEventInput,
  type CompleteProviderAttemptInput,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type DueRecoveryJobRecord,
  type OutboxEventRecord,
  type PendingOutboxEventRecord,
  type PaymentIntentRecord,
  type PaymentLedgerRepository,
  type PaymentStateEventRecord,
  type PrepareProviderAttemptInput,
  type PrepareProviderAttemptResult,
  type ProviderAttemptRecord,
  type ProviderEventResult,
  type RecordRecoverySignalInput,
  type RecoveryClockRecord,
  type TransitionPaymentInput,
} from './ledger.js';

interface IdempotencyEntry {
  requestHash: string;
  paymentId: string;
  responseBody: unknown;
}

function paymentKey(tenantId: string, paymentId: string): string {
  return `${tenantId}:${paymentId}`;
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function clonePayment(payment: PaymentIntentRecord): PaymentIntentRecord {
  return {
    ...payment,
    requestBody: structuredClone(payment.requestBody),
    responseBody: structuredClone(payment.responseBody),
    createdAt: new Date(payment.createdAt),
    updatedAt: new Date(payment.updatedAt),
  };
}

function cloneAttempt(attempt: ProviderAttemptRecord): ProviderAttemptRecord {
  return {
    ...attempt,
    createdAt: new Date(attempt.createdAt),
    completedAt: cloneDate(attempt.completedAt),
  };
}

function cloneRecovery(clock: RecoveryClockRecord): RecoveryClockRecord {
  return {
    ...clock,
    statusCheckDueAt: cloneDate(clock.statusCheckDueAt),
    pendingExpiresAt: cloneDate(clock.pendingExpiresAt),
    reversalDueAt: cloneDate(clock.reversalDueAt),
    complaintEligibleAt: cloneDate(clock.complaintEligibleAt),
    resolvedAt: cloneDate(clock.resolvedAt),
    updatedAt: new Date(clock.updatedAt),
  };
}

function eventTypeFor(state: PaymentState): string {
  if (state === 'SUBMITTED') return 'payment.submitted';
  if (state === 'REVERSAL_PENDING') return 'payment.reversal_due';
  if (state === 'REVERSED') return 'payment.reversed';
  return 'payment.state_changed';
}

function recoveryForTransition(
  existing: RecoveryClockRecord | undefined,
  tenantId: string,
  paymentId: string,
  toState: PaymentState,
  now: Date,
): RecoveryClockRecord | undefined {
  if (toState === 'SUBMITTED' || toState === 'PENDING') {
    return {
      tenantId,
      paymentId,
      statusCheckDueAt: new Date(now.getTime() + 5_000),
      pendingExpiresAt: new Date(now.getTime() + 60_000),
      reversalDueAt: existing?.reversalDueAt ?? null,
      complaintEligibleAt: existing?.complaintEligibleAt ?? null,
      resolvedAt: null,
      updatedAt: new Date(now),
    };
  }

  if (toState === 'REVERSAL_PENDING') {
    return {
      tenantId,
      paymentId,
      statusCheckDueAt: new Date(now.getTime() + 10_000),
      pendingExpiresAt: existing?.pendingExpiresAt ?? null,
      reversalDueAt: new Date(now.getTime() + 30_000),
      complaintEligibleAt: new Date(now.getTime() + 120_000),
      resolvedAt: null,
      updatedAt: new Date(now),
    };
  }

  if (
    toState === 'SUCCEEDED' ||
    toState === 'FAILED_SOFT' ||
    toState === 'FAILED_HARD' ||
    toState === 'REVERSED'
  ) {
    return {
      tenantId,
      paymentId,
      statusCheckDueAt: null,
      pendingExpiresAt: existing?.pendingExpiresAt ?? null,
      reversalDueAt: existing?.reversalDueAt ?? null,
      complaintEligibleAt: existing?.complaintEligibleAt ?? null,
      resolvedAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  return existing;
}

export class InMemoryPaymentLedgerRepository implements PaymentLedgerRepository {
  readonly #payments = new Map<string, PaymentIntentRecord>();
  readonly #idempotency = new Map<string, IdempotencyEntry>();
  readonly #stateEvents = new Map<string, PaymentStateEventRecord[]>();
  readonly #outboxEvents = new Map<string, OutboxEventRecord[]>();
  readonly #attempts = new Map<string, ProviderAttemptRecord>();
  readonly #providerEvents = new Map<string, ApplyProviderEventInput>();
  readonly #recoveryClocks = new Map<string, RecoveryClockRecord>();
  #failNextOutbox = false;

  failNextOutboxWrite(): void {
    this.#failNextOutbox = true;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const idempotencyKey = `${input.tenantId}:payment-intents:${input.idempotencyKey}`;
    const existing = this.#idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.requestHash !== input.requestHash) throw new IdempotencyConflictError();
      const payment = this.#requirePayment(input.tenantId, existing.paymentId);
      return {
        outcome: 'REPLAY',
        payment: clonePayment(payment),
        responseBody: structuredClone(existing.responseBody),
      };
    }

    const key = paymentKey(input.tenantId, input.paymentId);
    if (this.#payments.has(key)) throw new IdempotencyConflictError();
    this.#assertOutboxAvailable();

    const payment: PaymentIntentRecord = {
      id: input.paymentId,
      tenantId: input.tenantId,
      partnerCustomerRef: input.partnerCustomerRef,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestBody: structuredClone(input.requestBody),
      responseBody: structuredClone(input.responseBody),
      amountPaise: input.amountPaise,
      currency: input.currency,
      state: 'CREATED',
      decision: input.decision,
      providerRequestReference: null,
      resourceVersion: 1,
      createdAt: new Date(input.now),
      updatedAt: new Date(input.now),
    };
    const stateEvent = this.#stateEvent(
      payment,
      null,
      'CREATED',
      `${payment.id}:created`,
      'API',
      {},
      input.now,
    );
    const outbox = this.#outboxEvent(
      payment,
      stateEvent.eventKey,
      'payment_intent.created',
      input.now,
    );

    this.#payments.set(key, payment);
    this.#idempotency.set(idempotencyKey, {
      requestHash: input.requestHash,
      paymentId: input.paymentId,
      responseBody: structuredClone(input.responseBody),
    });
    this.#stateEvents.set(key, [stateEvent]);
    this.#outboxEvents.set(key, [outbox]);

    return {
      outcome: 'CREATED',
      payment: clonePayment(payment),
      responseBody: structuredClone(input.responseBody),
    };
  }

  async getPayment(tenantId: string, paymentId: string): Promise<PaymentIntentRecord | null> {
    const payment = this.#payments.get(paymentKey(tenantId, paymentId));
    return payment ? clonePayment(payment) : null;
  }

  async listPayments(tenantId: string, limit: number): Promise<PaymentIntentRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('Payment list limit must be between 1 and 100.');
    }
    return [...this.#payments.values()]
      .filter((payment) => payment.tenantId === tenantId)
      .sort((left, right) => {
        const byCreatedAt = right.createdAt.getTime() - left.createdAt.getTime();
        return byCreatedAt === 0 ? right.id.localeCompare(left.id) : byCreatedAt;
      })
      .slice(0, limit)
      .map(clonePayment);
  }

  async transitionPayment(input: TransitionPaymentInput): Promise<PaymentIntentRecord> {
    const payment = this.#requirePayment(input.tenantId, input.paymentId);
    if (payment.state === input.toState) return clonePayment(payment);
    assertPaymentTransition(payment.state, input.toState);
    this.#assertOutboxAvailable();
    return clonePayment(this.#commitTransition(payment, input));
  }

  async prepareProviderAttempt(
    input: PrepareProviderAttemptInput,
  ): Promise<PrepareProviderAttemptResult> {
    const payment = this.#requirePayment(input.tenantId, input.paymentId);
    const idempotencyKey =
      input.operation === 'SUBMIT' && input.idempotencyKey
        ? `${input.tenantId}:payment-submit:${input.idempotencyKey}`
        : null;
    if (input.operation === 'SUBMIT') {
      if (!idempotencyKey || !input.idempotencyRequestHash) {
        throw new Error('Provider submission requires a durable idempotency binding.');
      }
      const binding = this.#idempotency.get(idempotencyKey);
      if (
        binding &&
        (binding.requestHash !== input.idempotencyRequestHash ||
          binding.paymentId !== input.paymentId)
      ) {
        throw new IdempotencyConflictError();
      }
    }
    const existing = [...this.#attempts.values()].find(
      (attempt) =>
        attempt.tenantId === input.tenantId &&
        attempt.paymentId === input.paymentId &&
        (attempt.requestReference === input.requestReference ||
          (input.operation === 'SUBMIT' && attempt.operation === 'SUBMIT')),
    );
    if (existing) {
      if (idempotencyKey && input.idempotencyRequestHash) {
        this.#idempotency.set(idempotencyKey, {
          requestHash: input.idempotencyRequestHash,
          paymentId: input.paymentId,
          responseBody: null,
        });
      }
      return {
        created: false,
        attempt: cloneAttempt(existing),
        payment: clonePayment(payment),
      };
    }

    if (input.operation === 'SUBMIT') {
      assertPaymentTransition(payment.state, 'SUBMITTED');
    } else if (
      payment.state !== 'PENDING' &&
      payment.state !== 'SUBMITTED' &&
      payment.state !== 'REVERSAL_PENDING'
    ) {
      throw new Error(
        `Status inquiry requires SUBMITTED, PENDING, or REVERSAL_PENDING, received ${payment.state}.`,
      );
    }

    this.#assertOutboxAvailable();
    const attempt: ProviderAttemptRecord = {
      id: input.id,
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      provider: input.provider,
      operation: input.operation,
      requestReference: input.requestReference,
      requestHash: input.requestHash,
      status: 'STARTED',
      providerStatus: null,
      responseCode: null,
      createdAt: new Date(input.now),
      completedAt: null,
    };

    this.#attempts.set(`${input.tenantId}:${input.id}`, attempt);
    if (input.operation === 'SUBMIT') {
      this.#idempotency.set(idempotencyKey!, {
        requestHash: input.idempotencyRequestHash!,
        paymentId: input.paymentId,
        responseBody: null,
      });
      payment.providerRequestReference = input.requestReference;
      const transitioned = this.#commitTransition(payment, {
        tenantId: input.tenantId,
        paymentId: input.paymentId,
        toState: 'SUBMITTED',
        eventKey: input.eventKey,
        source: input.provider,
        evidence: { provider_request_ref: input.requestReference },
        now: input.now,
      });
      return { created: true, attempt: cloneAttempt(attempt), payment: clonePayment(transitioned) };
    }

    const key = paymentKey(input.tenantId, input.paymentId);
    const outbox = this.#outboxEvent(
      payment,
      input.eventKey,
      'payment.status_inquiry_requested',
      input.now,
    );
    this.#outboxEvents.set(key, [...(this.#outboxEvents.get(key) ?? []), outbox]);
    return { created: true, attempt: cloneAttempt(attempt), payment: clonePayment(payment) };
  }

  async completeProviderAttempt(input: CompleteProviderAttemptInput): Promise<ProviderEventResult> {
    const attempt = this.#attempts.get(`${input.tenantId}:${input.attemptId}`);
    if (!attempt) throw new Error(`Provider attempt ${input.attemptId} was not found.`);
    const payment = this.#requirePayment(input.tenantId, attempt.paymentId);
    if (attempt.status !== 'STARTED') {
      return { outcome: 'DUPLICATE', payment: clonePayment(payment) };
    }

    const canApply =
      payment.state === input.providerStatus ||
      canTransitionPayment(payment.state, input.providerStatus);
    if (canApply && payment.state !== input.providerStatus) this.#assertOutboxAvailable();

    attempt.status = input.responseCode === 'TIMEOUT_UNKNOWN' ? 'UNKNOWN' : 'COMPLETED';
    attempt.providerStatus = input.providerStatus;
    attempt.responseCode = input.responseCode;
    attempt.completedAt = new Date(input.now);

    if (
      attempt.operation === 'STATUS_INQUIRY' &&
      (payment.state === 'PENDING' || payment.state === 'REVERSAL_PENDING') &&
      (input.providerStatus === 'PENDING' || input.providerStatus === 'REVERSAL_PENDING')
    ) {
      const key = paymentKey(input.tenantId, payment.id);
      const clock = this.#recoveryClocks.get(key);
      if (clock) {
        this.#recoveryClocks.set(key, {
          ...clock,
          statusCheckDueAt: new Date(input.now.getTime() + 10_000),
          updatedAt: new Date(input.now),
        });
      }
    }

    if (!canApply) {
      return { outcome: 'IGNORED_STALE', payment: clonePayment(payment) };
    }
    if (payment.state === input.providerStatus) {
      return { outcome: 'APPLIED', payment: clonePayment(payment) };
    }

    const transitioned = this.#commitTransition(payment, {
      tenantId: input.tenantId,
      paymentId: payment.id,
      toState: input.providerStatus,
      eventKey: `${attempt.id}:completed:${input.providerStatus}`,
      source: attempt.provider,
      evidence: {
        provider_request_ref: attempt.requestReference,
        response_code: input.responseCode,
        ...(input.evidence ?? {}),
      },
      now: input.now,
    });
    return { outcome: 'APPLIED', payment: clonePayment(transitioned) };
  }

  async applyProviderEvent(input: ApplyProviderEventInput): Promise<ProviderEventResult> {
    const providerEventKey = `${input.tenantId}:${input.provider}:${input.providerEventId}`;
    const payment = this.#requirePayment(input.tenantId, input.paymentId);
    const existing = this.#providerEvents.get(providerEventKey);
    if (existing) {
      if (
        existing.paymentId !== input.paymentId ||
        existing.providerReference !== input.providerReference ||
        existing.providerStatus !== input.providerStatus ||
        existing.payloadHash !== input.payloadHash ||
        existing.amountPaise !== input.amountPaise
      ) {
        throw new ProviderPayloadMismatchError(
          'The provider event ID is bound to different content.',
        );
      }
      return { outcome: 'DUPLICATE', payment: clonePayment(payment) };
    }
    if (
      payment.amountPaise !== input.amountPaise ||
      payment.providerRequestReference !== input.providerReference
    ) {
      throw new ProviderPayloadMismatchError();
    }

    const canApply =
      payment.state === input.providerStatus ||
      canTransitionPayment(payment.state, input.providerStatus);
    if (canApply && payment.state !== input.providerStatus) this.#assertOutboxAvailable();
    this.#providerEvents.set(providerEventKey, {
      ...input,
      occurredAt: new Date(input.occurredAt),
      receivedAt: new Date(input.receivedAt),
    });

    if (!canApply) {
      return { outcome: 'IGNORED_STALE', payment: clonePayment(payment) };
    }
    if (payment.state === input.providerStatus) {
      return { outcome: 'DUPLICATE', payment: clonePayment(payment) };
    }

    const transitioned = this.#commitTransition(payment, {
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      toState: input.providerStatus,
      eventKey: `${input.provider}:${input.providerEventId}`,
      source: input.provider,
      evidence: {
        provider_event_id: input.providerEventId,
        provider_reference: input.providerReference,
        payload_hash: input.payloadHash,
        occurred_at: input.occurredAt.toISOString(),
      },
      now: input.receivedAt,
    });
    return { outcome: 'APPLIED', payment: clonePayment(transitioned) };
  }

  async getRecoveryClock(tenantId: string, paymentId: string): Promise<RecoveryClockRecord | null> {
    const clock = this.#recoveryClocks.get(paymentKey(tenantId, paymentId));
    return clock ? cloneRecovery(clock) : null;
  }

  async listStateEvents(tenantId: string, paymentId: string): Promise<PaymentStateEventRecord[]> {
    return (this.#stateEvents.get(paymentKey(tenantId, paymentId)) ?? []).map((event) => ({
      ...event,
      evidence: structuredClone(event.evidence),
      occurredAt: new Date(event.occurredAt),
    }));
  }

  async listOutboxEvents(tenantId: string, paymentId: string): Promise<OutboxEventRecord[]> {
    return (this.#outboxEvents.get(paymentKey(tenantId, paymentId)) ?? []).map((event) => ({
      ...event,
      payload: structuredClone(event.payload),
      createdAt: new Date(event.createdAt),
      publishedAt: cloneDate(event.publishedAt),
    }));
  }

  async listProviderAttempts(
    tenantId: string,
    paymentId: string,
  ): Promise<ProviderAttemptRecord[]> {
    return [...this.#attempts.values()]
      .filter((attempt) => attempt.tenantId === tenantId && attempt.paymentId === paymentId)
      .map(cloneAttempt);
  }

  async listDueRecoveryJobs(now: Date, limit: number): Promise<DueRecoveryJobRecord[]> {
    const jobs: DueRecoveryJobRecord[] = [];
    for (const clock of this.#recoveryClocks.values()) {
      const payment = this.#payments.get(paymentKey(clock.tenantId, clock.paymentId));
      if (!payment) continue;
      let operation: DueRecoveryJobRecord['operation'] | null = null;
      let dueAt: Date | null = null;
      if (payment.state === 'PENDING' && clock.pendingExpiresAt && clock.pendingExpiresAt <= now) {
        operation = 'PENDING_TIMEOUT';
        dueAt = clock.pendingExpiresAt;
      } else if (
        (payment.state === 'SUBMITTED' || payment.state === 'PENDING') &&
        clock.statusCheckDueAt &&
        clock.statusCheckDueAt <= now
      ) {
        operation = 'STATUS_CHECK';
        dueAt = clock.statusCheckDueAt;
      } else if (
        payment.state === 'REVERSAL_PENDING' &&
        clock.statusCheckDueAt &&
        clock.statusCheckDueAt <= now
      ) {
        operation = 'STATUS_CHECK';
        dueAt = clock.statusCheckDueAt;
      } else if (
        payment.state === 'REVERSAL_PENDING' &&
        ((clock.complaintEligibleAt && clock.complaintEligibleAt <= now) ||
          (clock.reversalDueAt && clock.reversalDueAt <= now))
      ) {
        operation = 'REVERSAL_CLOCK';
        dueAt =
          clock.complaintEligibleAt && clock.complaintEligibleAt <= now
            ? clock.complaintEligibleAt
            : clock.reversalDueAt;
      }
      if (!operation || !dueAt) continue;
      jobs.push({
        tenantId: clock.tenantId,
        paymentId: clock.paymentId,
        operation,
        recoveryKey: `${operation.toLowerCase()}-${dueAt.getTime()}`,
        dueAt: new Date(dueAt),
      });
    }
    return jobs.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()).slice(0, limit);
  }

  async listPendingOutboxEvents(now: Date, limit: number): Promise<PendingOutboxEventRecord[]> {
    return [...this.#outboxEvents.values()]
      .flat()
      .filter((event) => event.publishedAt === null && event.createdAt <= now)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((event) => ({
        id: event.id,
        tenantId: event.tenantId,
        aggregateId: event.aggregateId,
        eventKey: event.eventKey,
        eventType: event.eventType,
        payload: structuredClone(event.payload),
        createdAt: new Date(event.createdAt),
      }));
  }

  async getOutboxEvent(tenantId: string, outboxEventId: string): Promise<OutboxEventRecord | null> {
    const event = [...this.#outboxEvents.values()]
      .flat()
      .find((candidate) => candidate.tenantId === tenantId && candidate.id === outboxEventId);
    return event
      ? {
          ...event,
          payload: structuredClone(event.payload),
          createdAt: new Date(event.createdAt),
          publishedAt: cloneDate(event.publishedAt),
        }
      : null;
  }

  async markOutboxPublished(tenantId: string, outboxEventId: string, now: Date): Promise<boolean> {
    const event = [...this.#outboxEvents.values()]
      .flat()
      .find((candidate) => candidate.tenantId === tenantId && candidate.id === outboxEventId);
    if (!event || event.publishedAt) return false;
    event.publishedAt = new Date(now);
    return true;
  }

  async recordRecoverySignal(input: RecordRecoverySignalInput): Promise<void> {
    const payment = this.#requirePayment(input.tenantId, input.paymentId);
    const key = paymentKey(input.tenantId, input.paymentId);
    if ((this.#outboxEvents.get(key) ?? []).some((event) => event.eventKey === input.eventKey))
      return;
    this.#assertOutboxAvailable();
    const event = this.#outboxEvent(payment, input.eventKey, input.eventType, input.now);
    this.#outboxEvents.set(key, [...(this.#outboxEvents.get(key) ?? []), event]);
  }

  #requirePayment(tenantId: string, paymentId: string): PaymentIntentRecord {
    const payment = this.#payments.get(paymentKey(tenantId, paymentId));
    if (!payment) throw new PaymentNotFoundError(paymentId);
    return payment;
  }

  #assertOutboxAvailable(): void {
    if (!this.#failNextOutbox) return;
    this.#failNextOutbox = false;
    throw new Error('Synthetic outbox failure.');
  }

  #commitTransition(
    payment: PaymentIntentRecord,
    input: TransitionPaymentInput,
  ): PaymentIntentRecord {
    const key = paymentKey(input.tenantId, input.paymentId);
    const next: PaymentIntentRecord = {
      ...payment,
      state: input.toState,
      resourceVersion: payment.resourceVersion + 1,
      updatedAt: new Date(input.now),
    };
    const stateEvent = this.#stateEvent(
      next,
      payment.state,
      input.toState,
      input.eventKey,
      input.source,
      input.evidence ?? {},
      input.now,
    );
    const outbox = this.#outboxEvent(next, input.eventKey, eventTypeFor(input.toState), input.now);
    const recovery = recoveryForTransition(
      this.#recoveryClocks.get(key),
      input.tenantId,
      input.paymentId,
      input.toState,
      input.now,
    );

    this.#payments.set(key, next);
    this.#stateEvents.set(key, [...(this.#stateEvents.get(key) ?? []), stateEvent]);
    this.#outboxEvents.set(key, [...(this.#outboxEvents.get(key) ?? []), outbox]);
    if (recovery) this.#recoveryClocks.set(key, recovery);
    return next;
  }

  #stateEvent(
    payment: PaymentIntentRecord,
    fromState: PaymentState | null,
    toState: PaymentState,
    eventKey: string,
    source: string,
    evidence: Readonly<Record<string, unknown>>,
    occurredAt: Date,
  ): PaymentStateEventRecord {
    return {
      id: `se_${eventKey}`,
      tenantId: payment.tenantId,
      paymentId: payment.id,
      eventKey,
      fromState,
      toState,
      source,
      evidence: structuredClone(evidence),
      resourceVersion: payment.resourceVersion,
      occurredAt: new Date(occurredAt),
    };
  }

  #outboxEvent(
    payment: PaymentIntentRecord,
    eventKey: string,
    eventType: string,
    createdAt: Date,
  ): OutboxEventRecord {
    return {
      id: `oe_${eventKey}`,
      tenantId: payment.tenantId,
      aggregateId: payment.id,
      eventKey,
      eventType,
      payload: {
        payment_id: payment.id,
        state: payment.state,
        resource_version: payment.resourceVersion,
      },
      createdAt: new Date(createdAt),
      publishedAt: null,
    };
  }
}
