export const queueNames = {
  recovery: 'trinetra.recovery',
  reconciliation: 'trinetra.reconciliation',
  webhooks: 'trinetra.webhooks',
} as const;

export interface RecoveryJobData {
  tenantId: string;
  paymentId: string;
  operation: 'STATUS_CHECK' | 'PENDING_TIMEOUT' | 'REVERSAL_CLOCK';
  recoveryKey: string;
}

export interface ReconciliationJobData {
  tenantId: string;
  paymentId: string;
  reconciliationKey: string;
}

export interface WebhookJobData {
  tenantId: string;
  outboxEventId: string;
  deliveryKey: string;
}

export function recoveryJobId(data: RecoveryJobData): string {
  return [data.tenantId, data.paymentId, data.operation, data.recoveryKey].join('-');
}

export function reconciliationJobId(data: ReconciliationJobData): string {
  return [data.tenantId, data.paymentId, data.reconciliationKey].join('-');
}

export function webhookJobId(data: WebhookJobData): string {
  return [data.tenantId, data.outboxEventId, data.deliveryKey].join('-');
}
