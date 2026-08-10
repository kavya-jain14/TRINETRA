import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { workerEnvSchema } from '@trinetra/config';
import { createLogger } from '@trinetra/observability';

import { queueNames, type RecoveryJobData } from './queues.js';

const env = workerEnvSchema.parse(process.env);
const logger = createLogger(env.LOG_LEVEL);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker<RecoveryJobData>(
  queueNames.recovery,
  async (job) => {
    logger.info(
      { job_id: job.id, operation: job.data.operation, payment_id: job.data.paymentId },
      'Processing synthetic recovery job',
    );
  },
  { connection, concurrency: 4 },
);

worker.on('failed', (job, error) => {
  logger.error({ err: error, job_id: job?.id }, 'Recovery job failed');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Stopping TRINETRA worker');
  await worker.close();
  await connection.quit();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

logger.info({ queue: queueNames.recovery }, 'TRINETRA worker started');
