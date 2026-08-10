import type {
  PaymentIntentRequest,
  RiskAssessment,
  RiskDecision,
  RiskReason,
} from '@trinetra/contracts';

export interface EvaluationContext {
  now: Date;
  paymentIntentId: string;
  traceId: string;
}

type EvaluationResult = Omit<RiskAssessment, 'resource_version'> & { resource_version: 1 };

const userMessages = {
  UNKNOWN_DEVICE: 'This device has not been seen on this profile before.',
  AMOUNT_ABOVE_USER_P99: 'This amount is much higher than the configured demo baseline.',
  REFUND_COLLECT_CONFLICT: 'A collect request sends money; it does not receive a refund.',
  PAYEE_MERCHANT_MISMATCH: 'The receiver does not match the selected merchant.',
  REMOTE_ACCESS_ACTIVE: 'Screen sharing or remote access is active during this payment.',
  GRAPH_LINKED_DESTINATION: 'The destination is linked to a reported synthetic risk cluster.',
} as const;

function decisionFor(score: number): RiskDecision {
  if (score >= 85) return 'BLOCK';
  if (score >= 65) return 'STEP_UP';
  if (score >= 40) return 'WARN';
  return 'ALLOW';
}

function requiredAction(decision: RiskDecision): RiskAssessment['required_action']['type'] {
  const actions = {
    ALLOW: 'NONE',
    WARN: 'ACKNOWLEDGE_WARNING',
    STEP_UP: 'RECONFIRM_RECEIVER',
    BLOCK: 'STOP_PAYMENT',
  } as const;
  return actions[decision];
}

export function evaluatePaymentIntent(
  input: PaymentIntentRequest,
  context: EvaluationContext,
): EvaluationResult {
  const reasons: RiskReason[] = [];
  let identity = input.context.device_token.includes('trusted') ? 8 : 48;
  let intent = 6;
  let integrity = 4;

  if (identity >= 40) {
    reasons.push({ code: 'UNKNOWN_DEVICE', impact: 28, user_message: userMessages.UNKNOWN_DEVICE });
  }

  if (input.amount_paise > 500_000) {
    intent = Math.max(intent, 62);
    reasons.push({
      code: 'AMOUNT_ABOVE_USER_P99',
      impact: 24,
      user_message: userMessages.AMOUNT_ABOVE_USER_P99,
    });
  }

  if (input.direction === 'COLLECT' && input.context.user_claimed_goal === 'RECEIVE_REFUND') {
    intent = 96;
    reasons.push({
      code: 'REFUND_COLLECT_CONFLICT',
      impact: 72,
      user_message: userMessages.REFUND_COLLECT_CONFLICT,
    });
  }

  if (
    input.merchant !== undefined &&
    input.merchant.expected_name.toLocaleLowerCase('en-IN') !==
      input.beneficiary.resolved_name.toLocaleLowerCase('en-IN')
  ) {
    integrity = Math.max(integrity, 86);
    reasons.push({
      code: 'PAYEE_MERCHANT_MISMATCH',
      impact: 54,
      user_message: userMessages.PAYEE_MERCHANT_MISMATCH,
    });
  }

  if (input.context.remote_access_active) {
    integrity = 98;
    reasons.push({
      code: 'REMOTE_ACCESS_ACTIVE',
      impact: 90,
      user_message: userMessages.REMOTE_ACCESS_ACTIVE,
    });
  }

  if (input.beneficiary.vpa_token.includes('mule')) {
    integrity = Math.max(integrity, 92);
    reasons.push({
      code: 'GRAPH_LINKED_DESTINATION',
      impact: 75,
      user_message: userMessages.GRAPH_LINKED_DESTINATION,
    });
  }

  identity = Math.min(identity, 100);
  const weightedScore = Math.round(identity * 0.25 + intent * 0.35 + integrity * 0.4);
  const riskScore = Math.max(weightedScore, identity, intent, integrity);
  const decision = decisionFor(riskScore);
  const expiresAt = new Date(context.now.getTime() + 5 * 60 * 1000).toISOString();

  return {
    payment_intent_id: context.paymentIntentId,
    decision,
    risk_score: riskScore,
    subscores: { identity, intent, integrity },
    reasons: reasons.sort((left, right) => right.impact - left.impact),
    required_action: { type: requiredAction(decision), expires_at: expiresAt },
    rule_set_version: 'ruleset_foundation_1',
    case_id: decision === 'BLOCK' ? `case_${context.paymentIntentId.slice(3)}` : null,
    trace_id: context.traceId,
    resource_version: 1,
  };
}
