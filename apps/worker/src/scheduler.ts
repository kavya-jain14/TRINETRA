import type { PaymentLedgerRepository } from '@trinetra/payment-core';

import {
  recoveryJobId,
  type RecoveryJobData,
  type WebhookJobData,
  webhookJobId,
} from './queues.js';

interface DurableQueue<T> {
  add(
    name: string,
    data: T,
    options: {
      jobId: string;
      attempts?: number;
      backoff?: { type: 'exponential'; delay: number };
      removeOnComplete: number;
      removeOnFail: number;
    },
  ): Promise<unknown>;
}

export interface SchedulerDependencies {
  repository: PaymentLedgerRepository;
  recoveryQueue: DurableQueue<RecoveryJobData>;
  webhookQueue: DurableQueue<WebhookJobData>;
  batchSize?: number;
}

export async function enqueueDueWork(
  dependencies: SchedulerDependencies,
  now = new Date(),
): Promise<{ recoveryJobs: number; webhookJobs: number }> {
  const limit = dependencies.batchSize ?? 100;
  const [recoveryJobs, outboxEvents] = await Promise.all([
    dependencies.repository.listDueRecoveryJobs(now, limit),
    dependencies.repository.listPendingOutboxEvents(now, limit),
  ]);

  await Promise.all(
    recoveryJobs.map(async (job) => {
      const data: RecoveryJobData = {
        tenantId: job.tenantId,
        paymentId: job.paymentId,
        operation: job.operation,
        recoveryKey: job.recoveryKey,
      };
      await dependencies.recoveryQueue.add(job.operation.toLowerCase(), data, {
        jobId: recoveryJobId(data),
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      });
    }),
  );

  await Promise.all(
    outboxEvents.map(async (event) => {
      const data: WebhookJobData = {
        tenantId: event.tenantId,
        outboxEventId: event.id,
        deliveryKey: `outbox-${event.id}`,
      };
      await dependencies.webhookQueue.add('signed-delivery', data, {
        jobId: webhookJobId(data),
        attempts: 8,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      });
    }),
  );

  return { recoveryJobs: recoveryJobs.length, webhookJobs: outboxEvents.length };
}
