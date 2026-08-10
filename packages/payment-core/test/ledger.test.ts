import { describe, expect, it } from 'vitest';

import {
  DeterministicPaymentProviderAdapter,
  IdempotencyConflictError,
  IllegalPaymentTransitionError,
  InMemoryPaymentLedgerRepository,
  PaymentLedgerService,
  PaymentNotFoundError,
} from '../src/index.js';

const tenantA = '00000000-0000-4000-8000-000000000001';
const tenantB = '00000000-0000-4000-8000-000000000002';
const fixedNow = new Date('2026-08-10T12:00:00.000Z');

function buildHarness() {
  const repository = new InMemoryPaymentLedgerRepository();
  const provider = new DeterministicPaymentProviderAdapter();
  let id = 0;
  const service = new PaymentLedgerService({
    repository,
    provider,
    now: () => fixedNow,
    idFactory: () => String(++id).padStart(8, '0'),
  });
  return { repository, provider, service };
}

async function createAllowedPayment(
  service: PaymentLedgerService,
  paymentId = 'pi_payment_001',
  idempotencyKey = 'idem_payment_001',
) {
  return await service.createRiskEvaluatedPayment({
    paymentId,
    tenantId: tenantA,
    partnerCustomerRef: 'cust_demo_104',
    idempotencyKey,
    requestHash: `hash_${paymentId}`,
    requestBody: { amount_paise: 24_900 },
    responseBody: { payment_intent_id: paymentId, decision: 'ALLOW' },
    amountPaise: 24_900,
    currency: 'INR',
    decision: 'ALLOW',
  });
}

describe('payment ledger service', () => {
  it('persists the complete golden success path and matching outbox history', async () => {
    const { repository, service } = buildHarness();
    await createAllowedPayment(service);
    const result = await service.submitPayment(tenantA, 'pi_payment_001', 'SUCCESS_IMMEDIATE');

    expect(result.payment.state).toBe('SUCCEEDED');
    const events = await repository.listStateEvents(tenantA, 'pi_payment_001');
    const outbox = await repository.listOutboxEvents(tenantA, 'pi_payment_001');
    expect(events.map((event) => event.toState)).toEqual([
      'CREATED',
      'RISK_EVALUATING',
      'ALLOWED',
      'SUBMITTED',
      'SUCCEEDED',
    ]);
    expect(outbox).toHaveLength(events.length);
    expect(new Set(outbox.map((event) => event.eventKey)).size).toBe(outbox.length);
  });

  it('deduplicates callbacks and ignores a stale PENDING after success', async () => {
    const { repository, service } = buildHarness();
    await createAllowedPayment(service);
    await service.submitPayment(tenantA, 'pi_payment_001', 'PENDING_THEN_SUCCESS');

    const success = {
      event_id: 'pe_success_001',
      payment_id: 'pi_payment_001',
      provider_ref: 'psp_payment_001',
      status: 'SUCCEEDED',
      amount_paise: 24_900,
      occurred_at: fixedNow.toISOString(),
    } as const;
    expect((await service.applyProviderCallback(tenantA, success, 'payload_success')).outcome).toBe(
      'APPLIED',
    );
    expect((await service.applyProviderCallback(tenantA, success, 'payload_success')).outcome).toBe(
      'DUPLICATE',
    );

    const stale = {
      ...success,
      event_id: 'pe_stale_pending_001',
      status: 'PENDING',
    } as const;
    expect((await service.applyProviderCallback(tenantA, stale, 'payload_stale')).outcome).toBe(
      'IGNORED_STALE',
    );
    expect((await service.getPayment(tenantA, 'pi_payment_001'))?.state).toBe('SUCCEEDED');

    const events = await repository.listStateEvents(tenantA, 'pi_payment_001');
    expect(events.filter((event) => event.toState === 'SUCCEEDED')).toHaveLength(1);
  });

  it('never submits a blocked payment', async () => {
    const { service } = buildHarness();
    await service.createRiskEvaluatedPayment({
      paymentId: 'pi_blocked_001',
      tenantId: tenantA,
      partnerCustomerRef: 'cust_blocked_001',
      idempotencyKey: 'idem_blocked_001',
      requestHash: 'hash_blocked_001',
      requestBody: { amount_paise: 99_900 },
      responseBody: { payment_intent_id: 'pi_blocked_001', decision: 'BLOCK' },
      amountPaise: 99_900,
      currency: 'INR',
      decision: 'BLOCK',
    });

    await expect(
      service.submitPayment(tenantA, 'pi_blocked_001', 'SUCCESS_IMMEDIATE'),
    ).rejects.toThrow(IllegalPaymentTransitionError);
  });

  it('replays the same tenant idempotency result and conflicts on a changed body', async () => {
    const { service } = buildHarness();
    const created = await createAllowedPayment(service);
    const replay = await service.createRiskEvaluatedPayment({
      paymentId: 'pi_unused_replay_id',
      tenantId: tenantA,
      partnerCustomerRef: 'cust_demo_104',
      idempotencyKey: 'idem_payment_001',
      requestHash: 'hash_pi_payment_001',
      requestBody: { amount_paise: 24_900 },
      responseBody: { ignored: true },
      amountPaise: 24_900,
      currency: 'INR',
      decision: 'ALLOW',
    });

    expect(created.outcome).toBe('CREATED');
    expect(replay.outcome).toBe('REPLAY');
    expect(replay.payment.id).toBe('pi_payment_001');
    expect(replay.responseBody).toEqual({ payment_intent_id: 'pi_payment_001', decision: 'ALLOW' });

    await expect(
      service.createRiskEvaluatedPayment({
        paymentId: 'pi_changed_001',
        tenantId: tenantA,
        partnerCustomerRef: 'cust_demo_104',
        idempotencyKey: 'idem_payment_001',
        requestHash: 'different_hash',
        requestBody: { amount_paise: 25_000 },
        responseBody: { payment_intent_id: 'pi_changed_001' },
        amountPaise: 25_000,
        currency: 'INR',
        decision: 'ALLOW',
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it('uses status inquiry for PENDING without creating a second provider submission', async () => {
    const { provider, repository, service } = buildHarness();
    await createAllowedPayment(service);
    await service.submitPayment(tenantA, 'pi_payment_001', 'PENDING_THEN_SUCCESS');
    const recovered = await service.inquirePendingPayment(
      tenantA,
      'pi_payment_001',
      'recovery_001',
    );

    expect(recovered.payment.state).toBe('SUCCEEDED');
    expect(provider.submissionCount).toBe(1);
    expect(provider.inquiryCount).toBe(1);
    expect(
      (await repository.listProviderAttempts(tenantA, 'pi_payment_001')).map((a) => a.operation),
    ).toEqual(['SUBMIT', 'STATUS_INQUIRY']);
  });

  it('rolls back the state update when the outbox write fails', async () => {
    const { provider, repository, service } = buildHarness();
    await createAllowedPayment(service);
    const beforeEvents = await repository.listStateEvents(tenantA, 'pi_payment_001');
    const beforeOutbox = await repository.listOutboxEvents(tenantA, 'pi_payment_001');
    repository.failNextOutboxWrite();

    await expect(
      service.submitPayment(tenantA, 'pi_payment_001', 'SUCCESS_IMMEDIATE'),
    ).rejects.toThrow('Synthetic outbox failure.');
    expect((await service.getPayment(tenantA, 'pi_payment_001'))?.state).toBe('ALLOWED');
    expect(await repository.listStateEvents(tenantA, 'pi_payment_001')).toHaveLength(
      beforeEvents.length,
    );
    expect(await repository.listOutboxEvents(tenantA, 'pi_payment_001')).toHaveLength(
      beforeOutbox.length,
    );
    expect(await repository.listProviderAttempts(tenantA, 'pi_payment_001')).toHaveLength(0);
    expect(provider.submissionCount).toBe(0);
  });

  it('enforces tenant scoping for reads and mutations', async () => {
    const { repository, service } = buildHarness();
    await createAllowedPayment(service);

    expect(await service.getPayment(tenantB, 'pi_payment_001')).toBeNull();
    await expect(
      repository.transitionPayment({
        tenantId: tenantB,
        paymentId: 'pi_payment_001',
        toState: 'SUBMITTED',
        eventKey: 'cross_tenant_attempt',
        source: 'TEST',
        now: fixedNow,
      }),
    ).rejects.toThrow(PaymentNotFoundError);
  });

  it('starts bounded reversal and complaint clocks for a non-credit recovery', async () => {
    const { repository, service } = buildHarness();
    await createAllowedPayment(service);
    await service.submitPayment(tenantA, 'pi_payment_001', 'PENDING_THEN_REVERSED');
    await service.inquirePendingPayment(tenantA, 'pi_payment_001', 'recovery_001');

    const clock = await repository.getRecoveryClock(tenantA, 'pi_payment_001');
    expect(clock?.reversalDueAt?.toISOString()).toBe('2026-08-10T12:00:30.000Z');
    expect(clock?.complaintEligibleAt?.toISOString()).toBe('2026-08-10T12:02:00.000Z');
  });
});
