import type { PaymentState, ProviderPaymentStatus, RiskDecision } from '@trinetra/contracts';

export type ProviderAttemptOperation = 'SUBMIT' | 'STATUS_INQUIRY';
export type ProviderAttemptStatus = 'STARTED' | 'COMPLETED' | 'UNKNOWN';
export type ProviderEventOutcome = 'APPLIED' | 'DUPLICATE' | 'IGNORED_STALE';

export interface PaymentIntentRecord {
  id: string;
  tenantId: string;
  partnerCustomerRef: string;
  idempotencyKey: string;
  requestHash: string;
  requestBody: unknown;
  responseBody: unknown;
  amountPaise: number;
  currency: 'INR';
  state: PaymentState;
  decision: RiskDecision | null;
  providerRequestReference: string | null;
  resourceVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentStateEventRecord {
  id: string;
  tenantId: string;
  paymentId: string;
  eventKey: string;
  fromState: PaymentState | null;
  toState: PaymentState;
  source: string;
  evidence: Readonly<Record<string, unknown>>;
  resourceVersion: number;
  occurredAt: Date;
}

export interface OutboxEventRecord {
  id: string;
  tenantId: string;
  aggregateId: string;
  eventKey: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface ProviderAttemptRecord {
  id: string;
  tenantId: string;
  paymentId: string;
  provider: string;
  operation: ProviderAttemptOperation;
  requestReference: string;
  requestHash: string;
  status: ProviderAttemptStatus;
  providerStatus: ProviderPaymentStatus | null;
  responseCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface RecoveryClockRecord {
  tenantId: string;
  paymentId: string;
  statusCheckDueAt: Date | null;
  pendingExpiresAt: Date | null;
  reversalDueAt: Date | null;
  complaintEligibleAt: Date | null;
  resolvedAt: Date | null;
  updatedAt: Date;
}

export interface CreatePaymentInput {
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
  now: Date;
}

export interface CreatePaymentResult {
  outcome: 'CREATED' | 'REPLAY';
  payment: PaymentIntentRecord;
  responseBody: unknown;
}

export interface TransitionPaymentInput {
  tenantId: string;
  paymentId: string;
  toState: PaymentState;
  eventKey: string;
  source: string;
  evidence?: Readonly<Record<string, unknown>>;
  now: Date;
}

export interface PrepareProviderAttemptInput {
  id: string;
  tenantId: string;
  paymentId: string;
  provider: string;
  operation: ProviderAttemptOperation;
  requestReference: string;
  requestHash: string;
  idempotencyKey: string | null;
  idempotencyRequestHash: string | null;
  eventKey: string;
  now: Date;
}

export interface PrepareProviderAttemptResult {
  created: boolean;
  attempt: ProviderAttemptRecord;
  payment: PaymentIntentRecord;
}

export interface CompleteProviderAttemptInput {
  tenantId: string;
  attemptId: string;
  providerStatus: ProviderPaymentStatus;
  responseCode: string;
  evidence?: Readonly<Record<string, unknown>>;
  now: Date;
}

export interface ApplyProviderEventInput {
  id: string;
  tenantId: string;
  paymentId: string;
  provider: string;
  providerEventId: string;
  providerReference: string;
  providerStatus: ProviderPaymentStatus;
  payloadHash: string;
  amountPaise: number;
  occurredAt: Date;
  receivedAt: Date;
}

export interface ProviderEventResult {
  outcome: ProviderEventOutcome;
  payment: PaymentIntentRecord;
}

export type RecoveryJobOperation = 'STATUS_CHECK' | 'PENDING_TIMEOUT' | 'REVERSAL_CLOCK';

export interface DueRecoveryJobRecord {
  tenantId: string;
  paymentId: string;
  operation: RecoveryJobOperation;
  recoveryKey: string;
  dueAt: Date;
}

export interface PendingOutboxEventRecord {
  id: string;
  tenantId: string;
  aggregateId: string;
  eventKey: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  createdAt: Date;
}

export interface RecordRecoverySignalInput {
  tenantId: string;
  paymentId: string;
  eventKey: string;
  eventType: 'payment.reversal_escalation_required' | 'payment.complaint_eligible';
  now: Date;
}

export interface PaymentLedgerRepository {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPayment(tenantId: string, paymentId: string): Promise<PaymentIntentRecord | null>;
  transitionPayment(input: TransitionPaymentInput): Promise<PaymentIntentRecord>;
  prepareProviderAttempt(input: PrepareProviderAttemptInput): Promise<PrepareProviderAttemptResult>;
  completeProviderAttempt(input: CompleteProviderAttemptInput): Promise<ProviderEventResult>;
  applyProviderEvent(input: ApplyProviderEventInput): Promise<ProviderEventResult>;
  getRecoveryClock(tenantId: string, paymentId: string): Promise<RecoveryClockRecord | null>;
  listStateEvents(tenantId: string, paymentId: string): Promise<PaymentStateEventRecord[]>;
  listOutboxEvents(tenantId: string, paymentId: string): Promise<OutboxEventRecord[]>;
  listProviderAttempts(tenantId: string, paymentId: string): Promise<ProviderAttemptRecord[]>;
  listDueRecoveryJobs(now: Date, limit: number): Promise<DueRecoveryJobRecord[]>;
  listPendingOutboxEvents(now: Date, limit: number): Promise<PendingOutboxEventRecord[]>;
  getOutboxEvent(tenantId: string, outboxEventId: string): Promise<OutboxEventRecord | null>;
  markOutboxPublished(tenantId: string, outboxEventId: string, now: Date): Promise<boolean>;
  recordRecoverySignal(input: RecordRecoverySignalInput): Promise<void>;
}

export class PaymentNotFoundError extends Error {
  constructor(readonly paymentId: string) {
    super(`Payment ${paymentId} was not found.`);
    this.name = 'PaymentNotFoundError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key is already bound to a different request body.');
    this.name = 'IdempotencyConflictError';
  }
}

export class ProviderPayloadMismatchError extends Error {
  constructor(message = 'The provider event does not match the original payment or prior event.') {
    super(message);
    this.name = 'ProviderPayloadMismatchError';
  }
}
