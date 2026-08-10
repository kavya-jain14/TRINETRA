import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { workerEnvSchema } from '@trinetra/config';
import { createDatabase, ensureTenant, PostgresPaymentLedgerRepository } from '@trinetra/database';
import { createLogger } from '@trinetra/observability';
import { DeterministicPaymentProviderAdapter, PaymentLedgerService } from '@trinetra/payment-core';

import {
  queueNames,
  type ReconciliationJobData,
  type RecoveryJobData,
  type WebhookJobData,
} from './queues.js';
import { processReconciliationJob, processRecoveryJob, processWebhookJob } from './processors.js';

const env = workerEnvSchema.parse(process.env);
const logger = createLogger(env.LOG_LEVEL);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const { pool } = createDatabase(env.DATABASE_URL);
await ensureTenant(pool, {
  id: env.DEMO_TENANT_ID,
  slug: 'partner-demo',
  name: 'TRINETRA Synthetic Partner',
});
const repository = new PostgresPaymentLedgerRepository(pool);
const ledgerService = new PaymentLedgerService({
  repository,
  provider: new DeterministicPaymentProviderAdapter(),
});
const dependencies = { repository, ledgerService };

const recoveryWorker = new Worker<RecoveryJobData>(
  queueNames.recovery,
  async (job) => await processRecoveryJob(job.data, dependencies),
  { connection, concurrency: 4 },
);
const reconciliationWorker = new Worker<ReconciliationJobData>(
  queueNames.reconciliation,
  async (job) => await processReconciliationJob(job.data, dependencies),
  { connection, concurrency: 2 },
);
const webhookWorker = new Worker<WebhookJobData>(
  queueNames.webhooks,
  async (job) => await processWebhookJob(job.data),
  { connection, concurrency: 4 },
);
const workers = [recoveryWorker, reconciliationWorker, webhookWorker];

for (const worker of workers) {
  worker.on('failed', (job, error) => {
    logger.error({ err: error, job_id: job?.id, queue: worker.name }, 'Worker job failed');
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Stopping TRINETRA workers');
  await Promise.all(workers.map(async (worker) => await worker.close()));
  await connection.quit();
  await pool.end();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

logger.info({ queues: Object.values(queueNames) }, 'TRINETRA workers started');
