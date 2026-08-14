import { describe, expect, it } from 'vitest';

import {
  DeterministicPaymentProviderAdapter,
  InMemoryPaymentLedgerRepository,
  PaymentLedgerService,
} from '@trinetra/payment-core';

import { processRecoveryJob, processWebhookJob } from '../src/processors.js';
import { enqueueDueWork } from '../src/scheduler.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-08-10T12:00:00.000Z');

async function pendingHarness(scenario: 'PENDING_THEN_SUCCESS' | 'PENDING_THEN_REVERSED') {
  const repository = new InMemoryPaymentLedgerRepository();
  const provider = new DeterministicPaymentProviderAdapter();
  let id = 0;
  const ledgerService = new PaymentLedgerService({
    repository,
    provider,
    now: () => now,
    idFactory: () => String(++id).padStart(8, '0'),
  });
  await ledgerService.createRiskEvaluatedPayment({
    paymentId: 'pi_worker_001',
    tenantId,
    partnerCustomerRef: 'cust_worker_001',
    idempotencyKey: 'idem_worker_001',
    requestHash: 'hash_worker_001',
    requestBody: { amount_paise: 24_900 },
    responseBody: { payment_intent_id: 'pi_worker_001', decision: 'ALLOW' },
    amountPaise: 24_900,
    currency: 'INR',
    decision: 'ALLOW',
  });
  await ledgerService.submitPayment(tenantId, 'pi_worker_001', scenario);
  return { ledgerService, provider, repository };
}

describe('recovery processors', () => {
  it('performs a status inquiry without a second provider submission', async () => {
    const harness = await pendingHarness('PENDING_THEN_SUCCESS');
    const result = await processRecoveryJob(
      {
        tenantId,
        paymentId: 'pi_worker_001',
        operation: 'STATUS_CHECK',
        recoveryKey: 'status-001',
      },
      { ...harness, now: () => now },
    );

    expect(result).toEqual({ outcome: 'STATUS_CHECKED', state: 'SUCCEEDED' });
    expect(harness.provider.submissionCount).toBe(1);
    expect(harness.provider.inquiryCount).toBe(1);
  });

  it('moves an expired pending payment to reversal tracking', async () => {
    const harness = await pendingHarness('PENDING_THEN_REVERSED');
    const result = await processRecoveryJob(
      {
        tenantId,
        paymentId: 'pi_worker_001',
        operation: 'PENDING_TIMEOUT',
        recoveryKey: 'timeout-001',
      },
      { ...harness, now: () => now },
    );

    expect(result).toEqual({ outcome: 'REVERSAL_STARTED', state: 'REVERSAL_PENDING' });
    const clock = await harness.repository.getRecoveryClock(tenantId, 'pi_worker_001');
    expect(clock?.reversalDueAt?.toISOString()).toBe('2026-08-10T12:00:30.000Z');
  });

  it('continues status-first recovery from reversal pending to reversed', async () => {
    const harness = await pendingHarness('PENDING_THEN_REVERSED');
    const dependencies = { ...harness, now: () => now };

    const first = await processRecoveryJob(
      {
        tenantId,
        paymentId: 'pi_worker_001',
        operation: 'STATUS_CHECK',
        recoveryKey: 'reversal-status-001',
      },
      dependencies,
    );
    const [dueStatusCheck] = await harness.repository.listDueRecoveryJobs(
      new Date(now.getTime() + 10_000),
      10,
    );
    expect(dueStatusCheck).toMatchObject({
      paymentId: 'pi_worker_001',
      operation: 'STATUS_CHECK',
    });
    const second = await processRecoveryJob(
      {
        tenantId,
        paymentId: 'pi_worker_001',
        operation: 'STATUS_CHECK',
        recoveryKey: dueStatusCheck!.recoveryKey,
      },
      dependencies,
    );

    expect(first).toEqual({ outcome: 'STATUS_CHECKED', state: 'REVERSAL_PENDING' });
    expect(second).toEqual({ outcome: 'STATUS_CHECKED', state: 'REVERSED' });
    expect(harness.provider.submissionCount).toBe(1);
    expect(harness.provider.inquiryCount).toBe(2);
  });

  it('re-enqueues durable recovery clocks and unpublished outbox events idempotently', async () => {
    const harness = await pendingHarness('PENDING_THEN_SUCCESS');
    const recoveryAdds: Array<{ data: unknown; options: { jobId: string } }> = [];
    const webhookAdds: Array<{
      data: unknown;
      options: { jobId: string; attempts?: number; backoff?: { type: string; delay: number } };
    }> = [];
    const queue = (
      adds: Array<{
        data: unknown;
        options: { jobId: string; attempts?: number; backoff?: { type: string; delay: number } };
      }>,
    ) => ({
      async add(
        _name: string,
        data: unknown,
        options: {
          jobId: string;
          attempts?: number;
          backoff?: { type: 'exponential'; delay: number };
        },
      ) {
        adds.push({ data, options });
      },
    });
    const result = await enqueueDueWork(
      {
        repository: harness.repository,
        recoveryQueue: queue(recoveryAdds),
        webhookQueue: queue(webhookAdds),
      },
      new Date(now.getTime() + 61_000),
    );

    expect(result.recoveryJobs).toBe(1);
    expect(recoveryAdds[0]?.data).toMatchObject({ operation: 'PENDING_TIMEOUT' });
    expect(result.webhookJobs).toBeGreaterThan(0);
    expect(new Set(webhookAdds.map((entry) => entry.options.jobId)).size).toBe(webhookAdds.length);
    expect(webhookAdds[0]?.options).toMatchObject({
      attempts: 8,
      backoff: { type: 'exponential', delay: 1_000 },
    });
  });

  it('signs and durably marks an outbox delivery exactly once', async () => {
    const harness = await pendingHarness('PENDING_THEN_SUCCESS');
    const [event] = await harness.repository.listPendingOutboxEvents(now, 1);
    expect(event).toBeDefined();
    const data = {
      tenantId,
      outboxEventId: event!.id,
      deliveryKey: `outbox-${event!.id}`,
    };
    const deliveredBodies: string[] = [];
    const dependencies = {
      repository: harness.repository,
      signingSecret: 'worker-test-secret-at-least-32-characters',
      deliveryClient: {
        async deliver(input: { body: string }) {
          deliveredBodies.push(input.body);
        },
      },
      now: () => now,
    };
    const delivered = await processWebhookJob(data, dependencies);
    const duplicate = await processWebhookJob(data, dependencies);

    expect(delivered.outcome).toBe('DELIVERED');
    expect(delivered.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(duplicate.outcome).toBe('DUPLICATE');
    expect(deliveredBodies).toHaveLength(1);
    expect(
      (await harness.repository.getOutboxEvent(tenantId, event!.id))?.publishedAt?.toISOString(),
    ).toBe(now.toISOString());
  });

  it('leaves an outbox event unpublished when delivery fails', async () => {
    const harness = await pendingHarness('PENDING_THEN_SUCCESS');
    const [event] = await harness.repository.listPendingOutboxEvents(now, 1);
    expect(event).toBeDefined();

    await expect(
      processWebhookJob(
        {
          tenantId,
          outboxEventId: event!.id,
          deliveryKey: `outbox-${event!.id}`,
        },
        {
          repository: harness.repository,
          signingSecret: 'worker-test-secret-at-least-32-characters',
          deliveryClient: {
            async deliver() {
              throw new Error('Synthetic partner endpoint outage');
            },
          },
          now: () => now,
        },
      ),
    ).rejects.toThrow('Synthetic partner endpoint outage');
    expect((await harness.repository.getOutboxEvent(tenantId, event!.id))?.publishedAt).toBeNull();
  });
});
