import { describe, expect, it } from 'vitest';

import type { RiskAssessment } from '@trinetra/contracts';

import { CaseService, InMemoryCaseRepository } from '../src/index.js';

const fixedNow = new Date('2026-08-15T12:00:00.000Z');
const assessment: RiskAssessment = {
  payment_intent_id: 'pi_refund_demo',
  decision: 'BLOCK',
  risk_score: 98,
  subscores: { identity: 8, intent: 96, integrity: 98 },
  reasons: [
    {
      code: 'REMOTE_ACCESS_ACTIVE',
      impact: 90,
      user_message: 'Screen sharing or remote access is active during this payment.',
    },
    {
      code: 'REFUND_COLLECT_CONFLICT',
      impact: 72,
      user_message: 'A collect request sends money; it does not receive a refund.',
    },
  ],
  required_action: { type: 'STOP_PAYMENT', expires_at: '2026-08-15T12:05:00.000Z' },
  rule_set_version: 'ruleset_foundation_1',
  case_id: 'case_refund_demo',
  trace_id: 'tr_refund_demo',
  resource_version: 1,
};

describe('fraud case service', () => {
  it('opens one evidence-backed case and safely replays it', async () => {
    const repository = new InMemoryCaseRepository();
    const service = new CaseService(repository, () => fixedNow);

    const created = await service.ensureBlockedPaymentCase(
      '00000000-0000-4000-8000-000000000001',
      assessment.payment_intent_id,
      assessment,
    );
    const replayed = await service.ensureBlockedPaymentCase(
      '00000000-0000-4000-8000-000000000001',
      assessment.payment_intent_id,
      assessment,
    );

    expect(created).toMatchObject({
      outcome: 'CREATED',
      fraudCase: {
        id: 'case_refund_demo',
        status: 'OPEN',
        severity: 'CRITICAL',
        category: 'SOCIAL_ENGINEERING',
      },
    });
    expect(created?.fraudCase.evidence).toEqual([
      expect.objectContaining({
        code: 'REMOTE_ACCESS_ACTIVE',
        lens: 'INTEGRITY',
        evidence_ref: 'device:remote_access_active',
      }),
      expect.objectContaining({
        code: 'REFUND_COLLECT_CONFLICT',
        lens: 'INTENT',
        evidence_ref: 'payment_context:refund_collect_conflict',
      }),
    ]);
    expect(replayed?.outcome).toBe('REPLAY');
    expect(await repository.listCases('00000000-0000-4000-8000-000000000002', 10)).toEqual([]);
    expect(
      await repository.listCaseEvents('00000000-0000-4000-8000-000000000001', 'case_refund_demo'),
    ).toEqual([expect.objectContaining({ eventType: 'case.created', resourceVersion: 1 })]);
  });

  it('does not create a case for an allowed decision', async () => {
    const repository = new InMemoryCaseRepository();
    const service = new CaseService(repository, () => fixedNow);
    const allowed = { ...assessment, decision: 'ALLOW', case_id: null } as RiskAssessment;

    expect(
      await service.ensureBlockedPaymentCase(
        '00000000-0000-4000-8000-000000000001',
        allowed.payment_intent_id,
        allowed,
      ),
    ).toBeNull();
  });
});
