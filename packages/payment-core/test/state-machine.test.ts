import { describe, expect, it } from 'vitest';

import {
  assertPaymentTransition,
  canTransitionPayment,
  IllegalPaymentTransitionError,
} from '../src/index.js';

describe('payment state machine', () => {
  it('accepts the golden success path', () => {
    expect(canTransitionPayment('CREATED', 'RISK_EVALUATING')).toBe(true);
    expect(canTransitionPayment('RISK_EVALUATING', 'ALLOWED')).toBe(true);
    expect(canTransitionPayment('ALLOWED', 'SUBMITTED')).toBe(true);
    expect(canTransitionPayment('SUBMITTED', 'SUCCEEDED')).toBe(true);
  });

  it('never regresses a succeeded payment to pending', () => {
    expect(canTransitionPayment('SUCCEEDED', 'PENDING')).toBe(false);
    expect(() => assertPaymentTransition('SUCCEEDED', 'PENDING')).toThrow(
      IllegalPaymentTransitionError,
    );
  });

  it('never submits a blocked payment', () => {
    expect(canTransitionPayment('BLOCKED', 'SUBMITTED')).toBe(false);
  });

  it('does not treat pending as directly retryable', () => {
    expect(canTransitionPayment('PENDING', 'SUBMITTED')).toBe(false);
  });
});
