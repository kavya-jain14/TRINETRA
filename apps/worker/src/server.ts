import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { workerEnvSchema } from '@trinetra/config';
import {
  createDatabase,
  ensureTenant,
  PostgresDeterministicPaymentProviderAdapter,
  PostgresPaymentLedgerRepository,
} from '@trinetra/database';
import { createLogger } from '@trinetra/observability';
import { PaymentLedgerService } from '@trinetra/payment-core';

import {
  queueNames,
  type ReconciliationJobData,
  type RecoveryJobData,
  type WebhookJobData,
} from './queues.js';
import { processReconciliationJob, processRecoveryJob, processWebhookJob } from './processors.js';
import { enqueueDueWork } from './scheduler.js';
import { HttpWebhookDeliveryClient, WebhookDeliveryError } from './webhook-delivery.js';

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
  provider: new PostgresDeterministicPaymentProviderAdapter(pool),
});
const dependencies = { repository, ledgerService };
const webhookDeliveryClient = new HttpWebhookDeliveryClient(
  env.PARTNER_WEBHOOK_URL,
  env.WEBHOOK_DELIVERY_TIMEOUT_MS,
);
const recoveryQueue = new Queue<RecoveryJobData>(queueNames.recovery, { connection });
const webhookQueue = new Queue<WebhookJobData>(queueNames.webhooks, { connection });

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
  async (job) => {
    try {
      return await processWebhookJob(job.data, {
        repository,
        signingSecret: env.DEMO_PARTNER_SECRET,
        deliveryClient: webhookDeliveryClient,
      });
    } catch (error) {
      if (error instanceof WebhookDeliveryError && !error.retryable) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  },
  { connection, concurrency: 4 },
);
const workers = [recoveryWorker, reconciliationWorker, webhookWorker];
const queues = [recoveryQueue, webhookQueue];
let schedulerRunning = false;

async function scheduleDurableWork(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    await enqueueDueWork({ repository, recoveryQueue, webhookQueue });
  } catch (error) {
    logger.error({ err: error }, 'Durable work scheduling failed');
  } finally {
    schedulerRunning = false;
  }
}

const schedulerTimer = setInterval(() => void scheduleDurableWork(), 1_000);
void scheduleDurableWork();

for (const worker of workers) {
  worker.on('failed', (job, error) => {
    logger.error({ err: error, job_id: job?.id, queue: worker.name }, 'Worker job failed');
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Stopping TRINETRA workers');
  clearInterval(schedulerTimer);
  await Promise.all(workers.map(async (worker) => await worker.close()));
  await Promise.all(queues.map(async (queue) => await queue.close()));
  await connection.quit();
  await pool.end();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

logger.info({ queues: Object.values(queueNames) }, 'TRINETRA workers started');
