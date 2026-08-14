import type { PaymentState, ProviderPaymentStatus, RiskDecision } from '@trinetra/contracts';
import {
  assertPaymentTransition,
  canTransitionPayment,
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
  type ProviderAttemptOperation,
  type ProviderAttemptRecord,
  type ProviderAttemptStatus,
  type ProviderEventResult,
  type RecordRecoverySignalInput,
  type RecoveryClockRecord,
  type TransitionPaymentInput,
} from '@trinetra/payment-core';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface PaymentRow extends QueryResultRow {
  internal_id: string;
  id: string;
  tenant_id: string;
  partner_customer_ref: string;
  idempotency_key: string;
  request_hash: string;
  request_body: unknown;
  response_body: unknown;
  amount_paise: number;
  currency: 'INR';
  state: PaymentState;
  decision: RiskDecision | null;
  provider_request_reference: string | null;
  resource_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface IdempotencyRow extends QueryResultRow {
  request_hash: string;
  payment_external_ref: string;
  response_body: unknown;
}

interface ProviderAttemptRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  payment_id: string;
  provider: string;
  operation: ProviderAttemptOperation;
  request_reference: string;
  request_hash: string;
  status: ProviderAttemptStatus;
  provider_status: ProviderPaymentStatus | null;
  response_code: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
}

interface ProviderEventRow extends QueryResultRow {
  id: string;
  payment_intent_id: string;
  provider_reference: string;
  provider_status: ProviderPaymentStatus;
  payload_hash: string;
  amount_paise: number;
}

interface StateEventRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  payment_id: string;
  event_key: string;
  from_state: PaymentState | null;
  to_state: PaymentState;
  source: string;
  evidence: Readonly<Record<string, unknown>>;
  resource_version: number;
  occurred_at: Date | string;
}

interface OutboxEventRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  aggregate_id: string;
  event_key: string;
  event_type: string;
  payload: Readonly<Record<string, unknown>>;
  created_at: Date | string;
  published_at: Date | string | null;
}

interface RecoveryClockRow extends QueryResultRow {
  tenant_id: string;
  payment_id: string;
  status_check_due_at: Date | string | null;
  pending_expires_at: Date | string | null;
  reversal_due_at: Date | string | null;
  complaint_eligible_at: Date | string | null;
  resolved_at: Date | string | null;
  updated_at: Date | string;
}

const paymentProjection = `
  id AS internal_id,
  external_ref AS id,
  tenant_id,
  partner_customer_ref,
  idempotency_key,
  request_hash,
  request_body,
  response_body,
  amount_paise,
  currency,
  state,
  decision,
  provider_request_reference,
  resource_version,
  created_at,
  updated_at
`;

function asDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value);
}

function asNullableDate(value: Date | string | null): Date | null {
  return value === null ? null : asDate(value);
}

function toPayment(row: PaymentRow): PaymentIntentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    partnerCustomerRef: row.partner_customer_ref,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    requestBody: row.request_body,
    responseBody: row.response_body,
    amountPaise: row.amount_paise,
    currency: row.currency,
    state: row.state,
    decision: row.decision,
    providerRequestReference: row.provider_request_reference,
    resourceVersion: row.resource_version,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function toAttempt(row: ProviderAttemptRow): ProviderAttemptRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    paymentId: row.payment_id,
    provider: row.provider,
    operation: row.operation,
    requestReference: row.request_reference,
    requestHash: row.request_hash,
    status: row.status,
    providerStatus: row.provider_status,
    responseCode: row.response_code,
    createdAt: asDate(row.created_at),
    completedAt: asNullableDate(row.completed_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function eventTypeFor(state: PaymentState): string {
  if (state === 'SUBMITTED') return 'payment.submitted';
  if (state === 'REVERSAL_PENDING') return 'payment.reversal_due';
  if (state === 'REVERSED') return 'payment.reversed';
  return 'payment.state_changed';
}

export class PostgresPaymentLedgerRepository implements PaymentLedgerRepository {
  constructor(private readonly pool: Pool) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    try {
      return await this.#transaction(async (client) => {
        const idempotency = await this.#findIdempotency(client, input, true);
        if (idempotency) return await this.#replay(input, idempotency, client);

        const paymentResult = await client.query<PaymentRow>(
          `INSERT INTO payment_intents (
             tenant_id, partner_customer_ref, external_ref, idempotency_key, request_hash,
             request_body, response_body, amount_paise, currency, state, decision,
             resource_version, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CREATED', $10, 1, $11, $11)
           RETURNING ${paymentProjection}`,
          [
            input.tenantId,
            input.partnerCustomerRef,
            input.paymentId,
            input.idempotencyKey,
            input.requestHash,
            input.requestBody,
            input.responseBody,
            input.amountPaise,
            input.currency,
            input.decision,
            input.now,
          ],
        );
        const row = paymentResult.rows[0];
        if (!row) throw new Error('Payment insert did not return a row.');

        await client.query(
          `INSERT INTO idempotency_records (
             tenant_id, operation, key, request_hash, payment_external_ref, response_body,
             created_at, expires_at
           ) VALUES ($1, 'payment-intents', $2, $3, $4, $5, $6, $7)`,
          [
            input.tenantId,
            input.idempotencyKey,
            input.requestHash,
            input.paymentId,
            input.responseBody,
            input.now,
            new Date(input.now.getTime() + 24 * 60 * 60 * 1000),
          ],
        );
        await this.#appendTransitionArtifacts(client, row, {
          fromState: null,
          toState: 'CREATED',
          eventKey: `${input.paymentId}:created`,
          source: 'API',
          evidence: {},
          eventType: 'payment_intent.created',
          now: input.now,
        });
        return {
          outcome: 'CREATED',
          payment: toPayment(row),
          responseBody: input.responseBody,
        };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const client = await this.pool.connect();
      try {
        const idempotency = await this.#findIdempotency(client, input, false);
        if (!idempotency) throw error;
        return await this.#replay(input, idempotency, client);
      } finally {
        client.release();
      }
    }
  }

  async getPayment(tenantId: string, paymentId: string): Promise<PaymentIntentRecord | null> {
    const result = await this.pool.query<PaymentRow>(
      `SELECT ${paymentProjection}
         FROM payment_intents
        WHERE tenant_id = $1 AND external_ref = $2`,
      [tenantId, paymentId],
    );
    const row = result.rows[0];
    return row ? toPayment(row) : null;
  }

  async transitionPayment(input: TransitionPaymentInput): Promise<PaymentIntentRecord> {
    return await this.#transaction(async (client) => {
      const row = await this.#requirePayment(client, input.tenantId, input.paymentId, true);
      if (row.state === input.toState) return toPayment(row);
      assertPaymentTransition(row.state, input.toState);
      return toPayment(await this.#transition(client, row, input));
    });
  }

  async prepareProviderAttempt(
    input: PrepareProviderAttemptInput,
  ): Promise<PrepareProviderAttemptResult> {
    return await this.#transaction(async (client) => {
      const payment = await this.#requirePayment(client, input.tenantId, input.paymentId, true);
      if (input.operation === 'SUBMIT') {
        await this.#bindSubmitIdempotency(client, input, payment);
      }
      const existingResult = await client.query<ProviderAttemptRow>(
        `SELECT pa.id, pa.tenant_id, pi.external_ref AS payment_id, pa.provider, pa.operation,
                pa.request_reference, pa.request_hash, pa.status, pa.provider_status,
                pa.response_code, pa.created_at, pa.completed_at
           FROM provider_attempts pa
           JOIN payment_intents pi
             ON pi.tenant_id = pa.tenant_id AND pi.id = pa.payment_intent_id
          WHERE pa.tenant_id = $1
            AND pa.payment_intent_id = $2
            AND (pa.request_reference = $3 OR ($4 = 'SUBMIT' AND pa.operation = 'SUBMIT'))
          ORDER BY pa.created_at
          LIMIT 1`,
        [input.tenantId, payment.internal_id, input.requestReference, input.operation],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        return { created: false, attempt: toAttempt(existing), payment: toPayment(payment) };
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

      const attemptResult = await client.query<ProviderAttemptRow>(
        `INSERT INTO provider_attempts (
           id, tenant_id, payment_intent_id, provider, operation, request_reference,
           request_hash, status, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'STARTED', $8)
         RETURNING id, tenant_id, $9::text AS payment_id, provider, operation,
                   request_reference, request_hash, status, provider_status,
                   response_code, created_at, completed_at`,
        [
          input.id,
          input.tenantId,
          payment.internal_id,
          input.provider,
          input.operation,
          input.requestReference,
          input.requestHash,
          input.now,
          input.paymentId,
        ],
      );
      const attempt = attemptResult.rows[0];
      if (!attempt) throw new Error('Provider attempt insert did not return a row.');

      if (input.operation === 'SUBMIT') {
        await client.query(
          `UPDATE payment_intents
              SET provider_request_reference = $3
            WHERE tenant_id = $1 AND id = $2`,
          [input.tenantId, payment.internal_id, input.requestReference],
        );
        payment.provider_request_reference = input.requestReference;
        const transitioned = await this.#transition(client, payment, {
          tenantId: input.tenantId,
          paymentId: input.paymentId,
          toState: 'SUBMITTED',
          eventKey: input.eventKey,
          source: input.provider,
          evidence: { provider_request_ref: input.requestReference },
          now: input.now,
        });
        return { created: true, attempt: toAttempt(attempt), payment: toPayment(transitioned) };
      }

      await this.#appendOutbox(client, payment, {
        eventKey: input.eventKey,
        eventType: 'payment.status_inquiry_requested',
        now: input.now,
      });
      return { created: true, attempt: toAttempt(attempt), payment: toPayment(payment) };
    });
  }

  async completeProviderAttempt(input: CompleteProviderAttemptInput): Promise<ProviderEventResult> {
    return await this.#transaction(async (client) => {
      const attemptResult = await client.query<
        ProviderAttemptRow & { payment_internal_id: string }
      >(
        `SELECT pa.id, pa.tenant_id, pi.external_ref AS payment_id,
                pa.payment_intent_id AS payment_internal_id, pa.provider, pa.operation,
                pa.request_reference, pa.request_hash, pa.status, pa.provider_status,
                pa.response_code, pa.created_at, pa.completed_at
           FROM provider_attempts pa
           JOIN payment_intents pi
             ON pi.tenant_id = pa.tenant_id AND pi.id = pa.payment_intent_id
          WHERE pa.tenant_id = $1 AND pa.id = $2
          FOR UPDATE`,
        [input.tenantId, input.attemptId],
      );
      const attempt = attemptResult.rows[0];
      if (!attempt) throw new Error(`Provider attempt ${input.attemptId} was not found.`);
      const payment = await this.#requirePayment(client, input.tenantId, attempt.payment_id, true);
      if (attempt.status !== 'STARTED') {
        return { outcome: 'DUPLICATE', payment: toPayment(payment) };
      }

      await client.query(
        `UPDATE provider_attempts
            SET status = $3,
                provider_status = $4,
                response_code = $5,
                completed_at = $6
          WHERE tenant_id = $1 AND id = $2`,
        [
          input.tenantId,
          input.attemptId,
          input.responseCode === 'TIMEOUT_UNKNOWN' ? 'UNKNOWN' : 'COMPLETED',
          input.providerStatus,
          input.responseCode,
          input.now,
        ],
      );

      if (
        attempt.operation === 'STATUS_INQUIRY' &&
        (payment.state === 'PENDING' || payment.state === 'REVERSAL_PENDING') &&
        (input.providerStatus === 'PENDING' || input.providerStatus === 'REVERSAL_PENDING')
      ) {
        await client.query(
          `UPDATE payment_recovery_clocks
              SET status_check_due_at = $3,
                  updated_at = $4
            WHERE tenant_id = $1 AND payment_intent_id = $2`,
          [input.tenantId, payment.internal_id, new Date(input.now.getTime() + 10_000), input.now],
        );
      }

      if (payment.state === input.providerStatus) {
        return { outcome: 'APPLIED', payment: toPayment(payment) };
      }
      if (!canTransitionPayment(payment.state, input.providerStatus)) {
        return { outcome: 'IGNORED_STALE', payment: toPayment(payment) };
      }

      const transitioned = await this.#transition(client, payment, {
        tenantId: input.tenantId,
        paymentId: payment.id,
        toState: input.providerStatus,
        eventKey: `${attempt.id}:completed:${input.providerStatus}`,
        source: attempt.provider,
        evidence: {
          provider_request_ref: attempt.request_reference,
          response_code: input.responseCode,
          ...(input.evidence ?? {}),
        },
        now: input.now,
      });
      return { outcome: 'APPLIED', payment: toPayment(transitioned) };
    });
  }

  async applyProviderEvent(input: ApplyProviderEventInput): Promise<ProviderEventResult> {
    return await this.#transaction(async (client) => {
      const payment = await this.#requirePayment(client, input.tenantId, input.paymentId, true);
      if (
        payment.amount_paise !== input.amountPaise ||
        payment.provider_request_reference !== input.providerReference
      ) {
        throw new ProviderPayloadMismatchError();
      }

      const existingResult = await client.query<ProviderEventRow>(
        `SELECT id, payment_intent_id, provider_reference, provider_status,
                payload_hash, amount_paise
           FROM provider_events
          WHERE tenant_id = $1 AND provider = $2 AND provider_event_id = $3`,
        [input.tenantId, input.provider, input.providerEventId],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        this.#assertMatchingProviderEvent(existing, payment, input);
        return { outcome: 'DUPLICATE', payment: toPayment(payment) };
      }

      const inserted = await client.query<{ id: string } & QueryResultRow>(
        `INSERT INTO provider_events (
           id, tenant_id, payment_intent_id, provider, provider_event_id,
           provider_reference, provider_status, payload_hash, amount_paise,
           applied, occurred_at, received_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11)
         ON CONFLICT (tenant_id, provider, provider_event_id) DO NOTHING
         RETURNING id`,
        [
          input.id,
          input.tenantId,
          payment.internal_id,
          input.provider,
          input.providerEventId,
          input.providerReference,
          input.providerStatus,
          input.payloadHash,
          input.amountPaise,
          input.occurredAt,
          input.receivedAt,
        ],
      );
      if (inserted.rowCount === 0) {
        const conflictResult = await client.query<ProviderEventRow>(
          `SELECT id, payment_intent_id, provider_reference, provider_status,
                  payload_hash, amount_paise
             FROM provider_events
            WHERE tenant_id = $1 AND provider = $2 AND provider_event_id = $3`,
          [input.tenantId, input.provider, input.providerEventId],
        );
        const conflict = conflictResult.rows[0];
        if (!conflict) throw new Error('Provider event conflict could not be resolved.');
        this.#assertMatchingProviderEvent(conflict, payment, input);
        return { outcome: 'DUPLICATE', payment: toPayment(payment) };
      }

      if (payment.state === input.providerStatus) {
        await this.#markProviderEventApplied(client, input.tenantId, input.id);
        return { outcome: 'DUPLICATE', payment: toPayment(payment) };
      }
      if (!canTransitionPayment(payment.state, input.providerStatus)) {
        return { outcome: 'IGNORED_STALE', payment: toPayment(payment) };
      }

      const transitioned = await this.#transition(client, payment, {
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
      await this.#markProviderEventApplied(client, input.tenantId, input.id);
      return { outcome: 'APPLIED', payment: toPayment(transitioned) };
    });
  }

  async getRecoveryClock(tenantId: string, paymentId: string): Promise<RecoveryClockRecord | null> {
    const result = await this.pool.query<RecoveryClockRow>(
      `SELECT prc.tenant_id, pi.external_ref AS payment_id, prc.status_check_due_at,
              prc.pending_expires_at, prc.reversal_due_at, prc.complaint_eligible_at,
              prc.resolved_at, prc.updated_at
         FROM payment_recovery_clocks prc
         JOIN payment_intents pi
           ON pi.tenant_id = prc.tenant_id AND pi.id = prc.payment_intent_id
        WHERE prc.tenant_id = $1 AND pi.external_ref = $2`,
      [tenantId, paymentId],
    );
    const row = result.rows[0];
    return row ? this.#toRecoveryClock(row) : null;
  }

  async listStateEvents(tenantId: string, paymentId: string): Promise<PaymentStateEventRecord[]> {
    const result = await this.pool.query<StateEventRow>(
      `SELECT pse.id, pse.tenant_id, pi.external_ref AS payment_id, pse.event_key,
              pse.from_state, pse.to_state, pse.source, pse.evidence,
              pse.resource_version, pse.occurred_at
         FROM payment_state_events pse
         JOIN payment_intents pi
           ON pi.tenant_id = pse.tenant_id AND pi.id = pse.payment_intent_id
        WHERE pse.tenant_id = $1 AND pi.external_ref = $2
        ORDER BY pse.resource_version, pse.occurred_at, pse.id`,
      [tenantId, paymentId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      paymentId: row.payment_id,
      eventKey: row.event_key,
      fromState: row.from_state,
      toState: row.to_state,
      source: row.source,
      evidence: row.evidence,
      resourceVersion: row.resource_version,
      occurredAt: asDate(row.occurred_at),
    }));
  }

  async listOutboxEvents(tenantId: string, paymentId: string): Promise<OutboxEventRecord[]> {
    const result = await this.pool.query<OutboxEventRow>(
      `SELECT oe.id, oe.tenant_id, pi.external_ref AS aggregate_id, oe.event_key,
              oe.event_type, oe.payload, oe.created_at, oe.published_at
         FROM outbox_events oe
         JOIN payment_intents pi
           ON pi.tenant_id = oe.tenant_id AND pi.id = oe.aggregate_id
        WHERE oe.tenant_id = $1 AND pi.external_ref = $2
        ORDER BY oe.created_at, oe.id`,
      [tenantId, paymentId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      aggregateId: row.aggregate_id,
      eventKey: row.event_key,
      eventType: row.event_type,
      payload: row.payload,
      createdAt: asDate(row.created_at),
      publishedAt: asNullableDate(row.published_at),
    }));
  }

  async listProviderAttempts(
    tenantId: string,
    paymentId: string,
  ): Promise<ProviderAttemptRecord[]> {
    const result = await this.pool.query<ProviderAttemptRow>(
      `SELECT pa.id, pa.tenant_id, pi.external_ref AS payment_id, pa.provider,
              pa.operation, pa.request_reference, pa.request_hash, pa.status,
              pa.provider_status, pa.response_code, pa.created_at, pa.completed_at
         FROM provider_attempts pa
         JOIN payment_intents pi
           ON pi.tenant_id = pa.tenant_id AND pi.id = pa.payment_intent_id
        WHERE pa.tenant_id = $1 AND pi.external_ref = $2
        ORDER BY pa.created_at, pa.id`,
      [tenantId, paymentId],
    );
    return result.rows.map(toAttempt);
  }

  async listDueRecoveryJobs(now: Date, limit: number): Promise<DueRecoveryJobRecord[]> {
    const result = await this.pool.query<
      QueryResultRow & {
        tenant_id: string;
        payment_id: string;
        state: PaymentState;
        status_check_due_at: Date | string | null;
        pending_expires_at: Date | string | null;
        reversal_due_at: Date | string | null;
        complaint_eligible_at: Date | string | null;
      }
    >(
      `SELECT prc.tenant_id, pi.external_ref AS payment_id, pi.state,
              prc.status_check_due_at, prc.pending_expires_at,
              prc.reversal_due_at, prc.complaint_eligible_at
         FROM payment_recovery_clocks prc
         JOIN payment_intents pi
           ON pi.tenant_id = prc.tenant_id AND pi.id = prc.payment_intent_id
        WHERE (pi.state IN ('SUBMITTED', 'PENDING', 'REVERSAL_PENDING')
               AND prc.status_check_due_at <= $1)
           OR (pi.state = 'PENDING' AND prc.pending_expires_at <= $1)
           OR (pi.state = 'REVERSAL_PENDING'
               AND (prc.reversal_due_at <= $1 OR prc.complaint_eligible_at <= $1))
        ORDER BY CASE
          WHEN pi.state = 'PENDING' AND prc.pending_expires_at <= $1
            THEN prc.pending_expires_at
          WHEN pi.state IN ('SUBMITTED', 'PENDING', 'REVERSAL_PENDING')
               AND prc.status_check_due_at <= $1 THEN prc.status_check_due_at
          WHEN prc.complaint_eligible_at <= $1 THEN prc.complaint_eligible_at
          ELSE prc.reversal_due_at
        END
        LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => {
      let operation: DueRecoveryJobRecord['operation'];
      let dueAt: Date;
      if (
        row.state === 'PENDING' &&
        row.pending_expires_at &&
        asDate(row.pending_expires_at) <= now
      ) {
        operation = 'PENDING_TIMEOUT';
        dueAt = asDate(row.pending_expires_at);
      } else if (
        row.state === 'SUBMITTED' ||
        row.state === 'PENDING' ||
        (row.state === 'REVERSAL_PENDING' &&
          row.status_check_due_at !== null &&
          asDate(row.status_check_due_at) <= now)
      ) {
        operation = 'STATUS_CHECK';
        dueAt = asDate(row.status_check_due_at!);
      } else {
        operation = 'REVERSAL_CLOCK';
        dueAt =
          row.complaint_eligible_at && asDate(row.complaint_eligible_at) <= now
            ? asDate(row.complaint_eligible_at)
            : asDate(row.reversal_due_at!);
      }
      return {
        tenantId: row.tenant_id,
        paymentId: row.payment_id,
        operation,
        recoveryKey: `${operation.toLowerCase()}-${dueAt.getTime()}`,
        dueAt,
      };
    });
  }

  async listPendingOutboxEvents(now: Date, limit: number): Promise<PendingOutboxEventRecord[]> {
    const result = await this.pool.query<OutboxEventRow>(
      `SELECT oe.id, oe.tenant_id, pi.external_ref AS aggregate_id, oe.event_key,
              oe.event_type, oe.payload, oe.created_at, oe.published_at
         FROM outbox_events oe
         JOIN payment_intents pi
           ON pi.tenant_id = oe.tenant_id AND pi.id = oe.aggregate_id
        WHERE oe.published_at IS NULL AND oe.available_at <= $1
        ORDER BY oe.available_at, oe.created_at, oe.id
        LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      aggregateId: row.aggregate_id,
      eventKey: row.event_key,
      eventType: row.event_type,
      payload: row.payload,
      createdAt: asDate(row.created_at),
    }));
  }

  async getOutboxEvent(tenantId: string, outboxEventId: string): Promise<OutboxEventRecord | null> {
    const result = await this.pool.query<OutboxEventRow>(
      `SELECT oe.id, oe.tenant_id, pi.external_ref AS aggregate_id, oe.event_key,
              oe.event_type, oe.payload, oe.created_at, oe.published_at
         FROM outbox_events oe
         JOIN payment_intents pi
           ON pi.tenant_id = oe.tenant_id AND pi.id = oe.aggregate_id
        WHERE oe.tenant_id = $1 AND oe.id = $2`,
      [tenantId, outboxEventId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          tenantId: row.tenant_id,
          aggregateId: row.aggregate_id,
          eventKey: row.event_key,
          eventType: row.event_type,
          payload: row.payload,
          createdAt: asDate(row.created_at),
          publishedAt: asNullableDate(row.published_at),
        }
      : null;
  }

  async markOutboxPublished(tenantId: string, outboxEventId: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE outbox_events
          SET published_at = $3,
              publish_attempts = publish_attempts + 1
        WHERE tenant_id = $1 AND id = $2 AND published_at IS NULL
        RETURNING id`,
      [tenantId, outboxEventId, now],
    );
    return result.rowCount === 1;
  }

  async recordRecoverySignal(input: RecordRecoverySignalInput): Promise<void> {
    await this.#transaction(async (client) => {
      const payment = await this.#requirePayment(client, input.tenantId, input.paymentId, true);
      await client.query(
        `INSERT INTO outbox_events (
           tenant_id, aggregate_type, aggregate_id, event_key, event_type,
           payload, created_at, available_at
         ) VALUES ($1, 'payment_intent', $2, $3, $4, $5, $6, $6)
         ON CONFLICT (tenant_id, event_key) DO NOTHING`,
        [
          input.tenantId,
          payment.internal_id,
          input.eventKey,
          input.eventType,
          {
            payment_id: payment.id,
            state: payment.state,
            resource_version: payment.resource_version,
          },
          input.now,
        ],
      );
    });
  }

  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #bindSubmitIdempotency(
    client: PoolClient,
    input: PrepareProviderAttemptInput,
    payment: PaymentRow,
  ): Promise<void> {
    if (!input.idempotencyKey || !input.idempotencyRequestHash) {
      throw new Error('Provider submission requires a durable idempotency binding.');
    }
    const currentResult = await client.query<IdempotencyRow>(
      `SELECT request_hash, payment_external_ref, response_body
         FROM idempotency_records
        WHERE tenant_id = $1 AND operation = 'payment-submit' AND key = $2
        FOR UPDATE`,
      [input.tenantId, input.idempotencyKey],
    );
    const current = currentResult.rows[0];
    if (current) {
      if (
        current.request_hash !== input.idempotencyRequestHash ||
        current.payment_external_ref !== payment.id
      ) {
        throw new IdempotencyConflictError();
      }
      return;
    }

    await client.query(
      `INSERT INTO idempotency_records (
         tenant_id, operation, key, request_hash, payment_external_ref,
         response_body, created_at, expires_at
       ) VALUES ($1, 'payment-submit', $2, $3, $4, NULL, $5, $6)
       ON CONFLICT (tenant_id, operation, key) DO NOTHING
       RETURNING key`,
      [
        input.tenantId,
        input.idempotencyKey,
        input.idempotencyRequestHash,
        input.paymentId,
        input.now,
        new Date(input.now.getTime() + 24 * 60 * 60 * 1000),
      ],
    );

    const existingResult = await client.query<IdempotencyRow>(
      `SELECT request_hash, payment_external_ref, response_body
         FROM idempotency_records
        WHERE tenant_id = $1 AND operation = 'payment-submit' AND key = $2
        FOR UPDATE`,
      [input.tenantId, input.idempotencyKey],
    );
    const existing = existingResult.rows[0];
    if (
      !existing ||
      existing.request_hash !== input.idempotencyRequestHash ||
      existing.payment_external_ref !== payment.id
    ) {
      throw new IdempotencyConflictError();
    }
  }

  #assertMatchingProviderEvent(
    existing: ProviderEventRow,
    payment: PaymentRow,
    input: ApplyProviderEventInput,
  ): void {
    if (
      existing.payment_intent_id !== payment.internal_id ||
      existing.provider_reference !== input.providerReference ||
      existing.provider_status !== input.providerStatus ||
      existing.payload_hash !== input.payloadHash ||
      existing.amount_paise !== input.amountPaise
    ) {
      throw new ProviderPayloadMismatchError(
        'The provider event ID is bound to different content.',
      );
    }
  }

  async #findIdempotency(
    client: PoolClient,
    input: CreatePaymentInput,
    lock: boolean,
  ): Promise<IdempotencyRow | undefined> {
    const result = await client.query<IdempotencyRow>(
      `SELECT request_hash, payment_external_ref, response_body
         FROM idempotency_records
        WHERE tenant_id = $1 AND operation = 'payment-intents' AND key = $2
        ${lock ? 'FOR UPDATE' : ''}`,
      [input.tenantId, input.idempotencyKey],
    );
    return result.rows[0];
  }

  async #replay(
    input: CreatePaymentInput,
    idempotency: IdempotencyRow,
    client: PoolClient,
  ): Promise<CreatePaymentResult> {
    if (idempotency.request_hash !== input.requestHash) throw new IdempotencyConflictError();
    const payment = await this.#requirePayment(
      client,
      input.tenantId,
      idempotency.payment_external_ref,
      false,
    );
    return {
      outcome: 'REPLAY',
      payment: toPayment(payment),
      responseBody: idempotency.response_body,
    };
  }

  async #requirePayment(
    client: PoolClient,
    tenantId: string,
    paymentId: string,
    lock: boolean,
  ): Promise<PaymentRow> {
    const result = await client.query<PaymentRow>(
      `SELECT ${paymentProjection}
         FROM payment_intents
        WHERE tenant_id = $1 AND external_ref = $2
        ${lock ? 'FOR UPDATE' : ''}`,
      [tenantId, paymentId],
    );
    const row = result.rows[0];
    if (!row) throw new PaymentNotFoundError(paymentId);
    return row;
  }

  async #transition(
    client: PoolClient,
    payment: PaymentRow,
    input: TransitionPaymentInput,
  ): Promise<PaymentRow> {
    const result = await client.query<PaymentRow>(
      `UPDATE payment_intents
          SET state = $4,
              resource_version = resource_version + 1,
              submitted_at = CASE WHEN $4 = 'SUBMITTED' THEN $5 ELSE submitted_at END,
              pending_since = CASE
                WHEN $4 = 'PENDING' THEN COALESCE(pending_since, $5)
                ELSE pending_since
              END,
              completed_at = CASE
                WHEN $4 IN ('SUCCEEDED', 'FAILED_SOFT', 'FAILED_HARD', 'REVERSED') THEN $5
                ELSE completed_at
              END,
              updated_at = $5
        WHERE tenant_id = $1 AND id = $2 AND resource_version = $3
        RETURNING ${paymentProjection}`,
      [input.tenantId, payment.internal_id, payment.resource_version, input.toState, input.now],
    );
    const transitioned = result.rows[0];
    if (!transitioned) throw new Error('Concurrent payment update rejected.');
    await this.#appendTransitionArtifacts(client, transitioned, {
      fromState: payment.state,
      toState: input.toState,
      eventKey: input.eventKey,
      source: input.source,
      evidence: input.evidence ?? {},
      eventType: eventTypeFor(input.toState),
      now: input.now,
    });
    await this.#updateRecoveryClock(client, transitioned, input.toState, input.now);
    return transitioned;
  }

  async #appendTransitionArtifacts(
    client: PoolClient,
    payment: PaymentRow,
    input: {
      fromState: PaymentState | null;
      toState: PaymentState;
      eventKey: string;
      source: string;
      evidence: Readonly<Record<string, unknown>>;
      eventType: string;
      now: Date;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO payment_state_events (
         tenant_id, payment_intent_id, event_key, from_state, to_state,
         source, evidence, resource_version, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        payment.tenant_id,
        payment.internal_id,
        input.eventKey,
        input.fromState,
        input.toState,
        input.source,
        input.evidence,
        payment.resource_version,
        input.now,
      ],
    );
    await this.#appendOutbox(client, payment, {
      eventKey: input.eventKey,
      eventType: input.eventType,
      now: input.now,
    });
  }

  async #appendOutbox(
    client: PoolClient,
    payment: PaymentRow,
    input: { eventKey: string; eventType: string; now: Date },
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events (
         tenant_id, aggregate_type, aggregate_id, event_key, event_type,
         payload, created_at, available_at
       ) VALUES ($1, 'payment_intent', $2, $3, $4, $5, $6, $6)`,
      [
        payment.tenant_id,
        payment.internal_id,
        input.eventKey,
        input.eventType,
        {
          payment_id: payment.id,
          state: payment.state,
          resource_version: payment.resource_version,
        },
        input.now,
      ],
    );
  }

  async #updateRecoveryClock(
    client: PoolClient,
    payment: PaymentRow,
    toState: PaymentState,
    now: Date,
  ): Promise<void> {
    if (toState === 'SUBMITTED' || toState === 'PENDING') {
      await client.query(
        `INSERT INTO payment_recovery_clocks (
           tenant_id, payment_intent_id, status_check_due_at, pending_expires_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, payment_intent_id) DO UPDATE
           SET status_check_due_at = EXCLUDED.status_check_due_at,
               pending_expires_at = COALESCE(payment_recovery_clocks.pending_expires_at,
                                             EXCLUDED.pending_expires_at),
               resolved_at = NULL,
               updated_at = EXCLUDED.updated_at`,
        [
          payment.tenant_id,
          payment.internal_id,
          new Date(now.getTime() + 5_000),
          new Date(now.getTime() + 60_000),
          now,
        ],
      );
      return;
    }

    if (toState === 'REVERSAL_PENDING') {
      await client.query(
        `INSERT INTO payment_recovery_clocks (
           tenant_id, payment_intent_id, status_check_due_at, reversal_due_at,
           complaint_eligible_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, payment_intent_id) DO UPDATE
           SET status_check_due_at = EXCLUDED.status_check_due_at,
               reversal_due_at = EXCLUDED.reversal_due_at,
               complaint_eligible_at = EXCLUDED.complaint_eligible_at,
               resolved_at = NULL,
               updated_at = EXCLUDED.updated_at`,
        [
          payment.tenant_id,
          payment.internal_id,
          new Date(now.getTime() + 10_000),
          new Date(now.getTime() + 30_000),
          new Date(now.getTime() + 120_000),
          now,
        ],
      );
      return;
    }

    if (
      toState === 'SUCCEEDED' ||
      toState === 'FAILED_SOFT' ||
      toState === 'FAILED_HARD' ||
      toState === 'REVERSED'
    ) {
      await client.query(
        `INSERT INTO payment_recovery_clocks (
           tenant_id, payment_intent_id, resolved_at, updated_at
         ) VALUES ($1, $2, $3, $3)
         ON CONFLICT (tenant_id, payment_intent_id) DO UPDATE
           SET status_check_due_at = NULL,
               resolved_at = EXCLUDED.resolved_at,
               updated_at = EXCLUDED.updated_at`,
        [payment.tenant_id, payment.internal_id, now],
      );
    }
  }

  async #markProviderEventApplied(
    client: PoolClient,
    tenantId: string,
    eventId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE provider_events SET applied = true WHERE tenant_id = $1 AND id = $2`,
      [tenantId, eventId],
    );
  }

  #toRecoveryClock(row: RecoveryClockRow): RecoveryClockRecord {
    return {
      tenantId: row.tenant_id,
      paymentId: row.payment_id,
      statusCheckDueAt: asNullableDate(row.status_check_due_at),
      pendingExpiresAt: asNullableDate(row.pending_expires_at),
      reversalDueAt: asNullableDate(row.reversal_due_at),
      complaintEligibleAt: asNullableDate(row.complaint_eligible_at),
      resolvedAt: asNullableDate(row.resolved_at),
      updatedAt: asDate(row.updated_at),
    };
  }
}
