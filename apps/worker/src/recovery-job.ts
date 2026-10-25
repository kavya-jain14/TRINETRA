import { DelayedError, type Job } from 'bullmq';

import { processRecoveryJob, type ProcessorDependencies } from './processors.js';
import type { RecoveryJobData } from './queues.js';

export async function runRecoveryJob(
  job: Pick<Job<RecoveryJobData>, 'data' | 'moveToDelayed'>,
  dependencies: ProcessorDependencies,
  token?: string,
) {
  const result = await processRecoveryJob(job.data, dependencies);
  if (result.outcome === 'WAIT' && 'retryAt' in result) {
    await job.moveToDelayed(result.retryAt, token);
    // BullMQ must not complete this deterministic job ID before its deadline.
    throw new DelayedError();
  }
  return result;
}
