import type { Queue } from 'bullmq';

import { createLogger } from '@trinetra/observability';

import type { RecoveryJobData } from './queues.js';

const log = createLogger('info');

export async function startRecoveryScanner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  queue: Queue<RecoveryJobData>,
  intervalMs: number = 5000,
) {
  const interval = setInterval(async () => {
    try {
      const result = await pool.query(`
        SELECT tenant_id, payment_intent_id, status_check_due_at, pending_expires_at, reversal_due_at
        FROM payment_recovery_clocks
        WHERE (status_check_due_at <= now() OR reversal_due_at <= now())
          AND resolved_at IS NULL
        LIMIT 100
      `);

      for (const row of result.rows) {
        let operation: 'STATUS_CHECK' | 'PENDING_TIMEOUT' = 'STATUS_CHECK';
        if (row.reversal_due_at && new Date(row.reversal_due_at) <= new Date()) {
          operation = 'PENDING_TIMEOUT';
        }

        await queue.add(
          'recovery',
          {
            tenantId: row.tenant_id,
            paymentId: row.payment_intent_id,
            operation,
            recoveryKey: `${row.payment_intent_id}-${new Date().toISOString()}`,
          },
          { jobId: `recovery-${row.payment_intent_id}-${operation}` },
        );

        if (operation === 'STATUS_CHECK') {
          await pool.query(
            `UPDATE payment_recovery_clocks SET status_check_due_at = status_check_due_at + interval '10 seconds' WHERE tenant_id = $1 AND payment_intent_id = $2`,
            [row.tenant_id, row.payment_intent_id],
          );
        } else {
          await pool.query(
            `UPDATE payment_recovery_clocks SET reversal_due_at = reversal_due_at + interval '60 seconds' WHERE tenant_id = $1 AND payment_intent_id = $2`,
            [row.tenant_id, row.payment_intent_id],
          );
        }
      }
    } catch (error) {
      log.error({ err: error }, 'Recovery scanner tick failed');
    }
  }, intervalMs);

  return () => clearInterval(interval);
}
