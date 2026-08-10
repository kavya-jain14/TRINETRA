import {
  PaymentNotFoundError,
  type PaymentLedgerRepository,
  type PaymentLedgerService,
} from '@trinetra/payment-core';

import type { ReconciliationJobData, RecoveryJobData, WebhookJobData } from './queues.js';

export interface ProcessorDependencies {
  repository: PaymentLedgerRepository;
  ledgerService: PaymentLedgerService;
  now?: () => Date;
}

export async function processRecoveryJob(
  data: RecoveryJobData,
  dependencies: ProcessorDependencies,
) {
  const now = dependencies.now?.() ?? new Date();
  const payment = await dependencies.repository.getPayment(data.tenantId, data.paymentId);
  if (!payment) throw new PaymentNotFoundError(data.paymentId);

  if (data.operation === 'STATUS_CHECK') {
    if (payment.state !== 'PENDING') return { outcome: 'NOOP', state: payment.state } as const;
    const result = await dependencies.ledgerService.inquirePendingPayment(
      data.tenantId,
      data.paymentId,
      data.recoveryKey,
    );
    return { outcome: 'STATUS_CHECKED', state: result.payment.state } as const;
  }

  if (data.operation === 'PENDING_TIMEOUT') {
    if (payment.state !== 'PENDING') return { outcome: 'NOOP', state: payment.state } as const;
    const transitioned = await dependencies.repository.transitionPayment({
      tenantId: data.tenantId,
      paymentId: data.paymentId,
      toState: 'REVERSAL_PENDING',
      eventKey: `${data.paymentId}:pending-timeout:${data.recoveryKey}`,
      source: 'RECOVERY_WORKER',
      evidence: { recovery: 'REVERSAL_CLOCK_STARTED' },
      now,
    });
    return { outcome: 'REVERSAL_STARTED', state: transitioned.state } as const;
  }

  const clock = await dependencies.repository.getRecoveryClock(data.tenantId, data.paymentId);
  if (payment.state !== 'REVERSAL_PENDING' || !clock?.reversalDueAt) {
    return { outcome: 'NOOP', state: payment.state } as const;
  }
  if (clock.complaintEligibleAt && clock.complaintEligibleAt <= now) {
    return { outcome: 'COMPLAINT_ELIGIBLE', state: payment.state } as const;
  }
  if (clock.reversalDueAt <= now) {
    return { outcome: 'ESCALATE_REVERSAL', state: payment.state } as const;
  }
  return { outcome: 'WAIT', state: payment.state } as const;
}

export async function processReconciliationJob(
  data: ReconciliationJobData,
  dependencies: ProcessorDependencies,
) {
  const payment = await dependencies.repository.getPayment(data.tenantId, data.paymentId);
  if (!payment) throw new PaymentNotFoundError(data.paymentId);
  if (payment.state !== 'PENDING') return { outcome: 'NOOP', state: payment.state } as const;
  const result = await dependencies.ledgerService.inquirePendingPayment(
    data.tenantId,
    data.paymentId,
    `reconciliation-${data.reconciliationKey}`,
  );
  return { outcome: 'RECONCILED', state: result.payment.state } as const;
}

export async function processWebhookJob(data: WebhookJobData) {
  return {
    outcome: 'READY_FOR_SIGNED_DELIVERY',
    tenantId: data.tenantId,
    outboxEventId: data.outboxEventId,
    deliveryKey: data.deliveryKey,
  } as const;
}
