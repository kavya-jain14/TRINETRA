import type { PaymentState } from '@trinetra/contracts';

const allowedTransitions: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  CREATED: ['RISK_EVALUATING'],
  RISK_EVALUATING: ['ALLOWED', 'CHALLENGED', 'BLOCKED'],
  ALLOWED: ['SUBMITTED'],
  CHALLENGED: ['ALLOWED', 'BLOCKED'],
  BLOCKED: [],
  SUBMITTED: ['PENDING', 'SUCCEEDED', 'FAILED_HARD'],
  PENDING: ['SUCCEEDED', 'FAILED_SOFT', 'REVERSAL_PENDING'],
  SUCCEEDED: ['DISPUTED'],
  FAILED_SOFT: ['CLOSED'],
  FAILED_HARD: ['CLOSED'],
  REVERSAL_PENDING: ['REVERSED'],
  REVERSED: ['CLOSED'],
  DISPUTED: ['CLOSED'],
  CLOSED: [],
};

export class IllegalPaymentTransitionError extends Error {
  constructor(
    readonly from: PaymentState,
    readonly to: PaymentState,
  ) {
    super(`Illegal payment transition: ${from} -> ${to}`);
    this.name = 'IllegalPaymentTransitionError';
  }
}

export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransitionPayment(from, to)) {
    throw new IllegalPaymentTransitionError(from, to);
  }
}

export function isTerminalPaymentState(state: PaymentState): boolean {
  return allowedTransitions[state].length === 0;
}

export const paymentStateTransitions = allowedTransitions;
