export const queueNames = {
  recovery: 'trinetra.recovery',
  reconciliation: 'trinetra.reconciliation',
  webhooks: 'trinetra.webhooks',
} as const;

export interface RecoveryJobData {
  tenantId: string;
  paymentId: string;
  operation: 'STATUS_CHECK' | 'REVERSAL_CLOCK' | 'DELIVER_WEBHOOK';
}
