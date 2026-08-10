import { describe, expect, it } from 'vitest';

import {
  DeterministicPaymentProviderAdapter,
  InMemoryPaymentLedgerRepository,
  PaymentLedgerService,
} from '@trinetra/payment-core';

import { processRecoveryJob } from '../src/processors.js';

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
});
