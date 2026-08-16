import { useState } from 'react';

import type { DemoPaymentSnapshot, DemoScenario } from '@trinetra/contracts';

import { recoverDemoScenario, runDemoScenario } from './demo-api';

type ScenarioKey = DemoScenario['key'];

function nextRunId(): string {
  return `run_${crypto.randomUUID().replaceAll('-', '')}`;
}

function formatClock(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

const journey = {
  'trusted-payment': {
    eyebrow: 'Everyday payment',
    counterparty: 'Aarav Electronics',
    amount: '₹249',
    mark: 'AE',
    facts: [
      ['Receiver match', 'Verified synthetic merchant'],
      ['Device context', 'Known demo device'],
      ['UPI action', 'Pay merchant'],
    ],
  },
  'refund-collect': {
    eyebrow: 'Incoming refund claim',
    counterparty: 'Synthetic Refund Desk',
    amount: '₹1,999 refund?',
    mark: 'RF',
    facts: [
      ['Message claims', 'Approve to receive money'],
      ['Actual UPI action', 'COLLECT · can debit'],
      ['Remote assistance', 'Active in synthetic fixture'],
    ],
  },
  'timeout-recovery': {
    eyebrow: 'Provider response interrupted',
    counterparty: 'Metro Utilities Demo',
    amount: '₹786',
    mark: 'MU',
    facts: [
      ['Provider outcome', 'Accepted · final response missing'],
      ['Safe ledger state', 'PENDING · not failed'],
      ['Recovery rule', 'Check status · never pay twice'],
    ],
  },
  'reversal-recovery': {
    eyebrow: 'Merchant confirmation missing',
    counterparty: 'Harbor Cafe Demo',
    amount: '₹425',
    mark: 'HC',
    facts: [
      ['Debit signal', 'Acknowledged in synthetic fixture'],
      ['Merchant confirmation', 'Missing · do not pay again'],
      ['Recovery rule', 'Track original reference to reversal'],
    ],
  },
  'mule-network': {
    eyebrow: 'Bounded network-risk check',
    counterparty: 'Orchid Supplies Demo',
    amount: '₹649',
    mark: 'OS',
    facts: [
      ['Destination', 'New synthetic beneficiary'],
      ['Graph bound', 'Maximum two hops · 90-day window'],
      ['Safety rule', 'Association is a signal—not proof'],
    ],
  },
} as const;

export function App() {
  const [scenario, setScenario] = useState<ScenarioKey>('trusted-payment');
  const [runId, setRunId] = useState(nextRunId);
  const [snapshot, setSnapshot] = useState<DemoPaymentSnapshot | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'recovering' | 'completed' | 'failed'>(
    'idle',
  );
  const [replayConfirmed, setReplayConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = journey[scenario];
  const blocked = snapshot?.assessment.decision === 'BLOCK';
  const pending = snapshot?.payment.state === 'PENDING';
  const reversalPending = snapshot?.payment.state === 'REVERSAL_PENDING';
  const timeoutFlow = scenario === 'timeout-recovery';
  const reversalFlow = scenario === 'reversal-recovery';
  const graphFlow = scenario === 'mule-network';
  const recoveryFlow = timeoutFlow || reversalFlow;
  const recoverable = pending || reversalPending;

  function reset(nextScenario = scenario) {
    setScenario(nextScenario);
    setRunId(nextRunId());
    setSnapshot(null);
    setReplayConfirmed(false);
    setStatus('idle');
    setError(null);
  }

  async function inspectJourney() {
    if (snapshot && !pending) {
      reset();
      return;
    }

    setStatus('running');
    setError(null);
    try {
      const result = await runDemoScenario(scenario, runId);
      setSnapshot(result);
      if (snapshot && recoveryFlow) setReplayConfirmed(true);
      setStatus('completed');
    } catch (caught) {
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'TRINETRA demo request failed.');
    }
  }

  async function recoverJourney() {
    if (scenario !== 'timeout-recovery' && scenario !== 'reversal-recovery') return;
    setStatus('recovering');
    setError(null);
    try {
      setSnapshot(await recoverDemoScenario(scenario, runId));
      setStatus('completed');
    } catch (caught) {
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'TRINETRA recovery request failed.');
    }
  }

  return (
    <main className="app-shell consumer-shell">
      <div className="consumer-header">
        <div className="eyebrow">TRINETRA / Synthetic journey</div>
        <div className="scenario-switch" aria-label="Demo scenario">
          <button
            type="button"
            className={scenario === 'trusted-payment' ? 'is-active' : ''}
            onClick={() => reset('trusted-payment')}
          >
            Trusted payment
          </button>
          <button
            type="button"
            className={scenario === 'refund-collect' ? 'is-active risk-option' : 'risk-option'}
            onClick={() => reset('refund-collect')}
          >
            Refund trap
          </button>
          <button
            type="button"
            className={
              scenario === 'timeout-recovery' ? 'is-active pending-option' : 'pending-option'
            }
            onClick={() => reset('timeout-recovery')}
          >
            Safe recovery
          </button>
          <button
            type="button"
            className={
              scenario === 'reversal-recovery' ? 'is-active pending-option' : 'pending-option'
            }
            onClick={() => reset('reversal-recovery')}
          >
            Reversal watch
          </button>
          <button
            type="button"
            className={scenario === 'mule-network' ? 'is-active risk-option' : 'risk-option'}
            onClick={() => reset('mule-network')}
          >
            Network risk
          </button>
        </div>
      </div>

      <section
        className={
          scenario === 'refund-collect' || graphFlow
            ? 'panel payment-card risk-flow'
            : recoveryFlow
              ? 'panel payment-card pending-flow'
              : 'panel payment-card'
        }
        aria-labelledby="payment-title"
      >
        <div className="merchant-mark" aria-hidden="true">
          {selected.mark}
        </div>
        <p className="muted">{selected.eyebrow}</p>
        <h1 id="payment-title">{selected.counterparty}</h1>
        <div className="amount">{selected.amount}</div>

        <dl className="payment-facts">
          {selected.facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {snapshot ? (
          <section
            className={
              blocked
                ? 'payment-result is-blocked'
                : recoverable
                  ? 'payment-result is-pending'
                  : 'payment-result'
            }
            aria-live="polite"
          >
            <div className="result-state">
              <span className="status-dot" aria-hidden="true" />
              {blocked
                ? graphFlow
                  ? 'Payment blocked by bounded graph evidence'
                  : 'Payment blocked before submission'
                : reversalPending
                  ? 'Reversal monitoring active · do not pay again'
                  : pending
                    ? reversalFlow
                      ? 'Debit acknowledged · merchant confirmation missing'
                      : 'Payment pending—not failed'
                    : reversalFlow
                      ? 'Reversal recorded on the original payment'
                      : timeoutFlow
                        ? 'Recovered safely · payment succeeded'
                        : 'Payment succeeded'}
            </div>
            <div className="result-grid">
              <span>
                Decision <strong>{snapshot.assessment.decision}</strong>
              </span>
              <span>
                Risk score <strong>{snapshot.assessment.risk_score}</strong>
              </span>
              <span>
                Final state <strong>{snapshot.payment.state}</strong>
              </span>
            </div>
            {blocked ? (
              <div className="safety-explanation">
                <strong>
                  {graphFlow
                    ? 'This destination is two hops from confirmed synthetic fraud cases.'
                    : 'This request would send money—not receive a refund.'}
                </strong>
                <ul>
                  {snapshot.assessment.reasons.map((reason) => (
                    <li key={reason.code}>{reason.user_message}</li>
                  ))}
                </ul>
                <p>
                  {graphFlow
                    ? `Bounded evidence: ${snapshot.graph?.linked_confirmed_cases ?? 0} confirmed cases · ${snapshot.graph?.nodes.length ?? 0} nodes inspected. Association is a review signal, not proof of guilt. No provider submission was made.`
                    : 'Safe action: close the request and contact the organisation through its official channel. No provider submission was made.'}
                </p>
              </div>
            ) : null}
            {recoveryFlow ? (
              <div className="safety-explanation recovery-explanation">
                <strong>
                  {reversalPending
                    ? 'Debit is acknowledged but merchant confirmation is missing. Monitoring the original reference—do not pay again.'
                    : pending
                      ? 'Do not create another payment—the original provider reference is preserved.'
                      : reversalFlow
                        ? 'The provider reports the original debit as reversed; the durable ledger is resolved.'
                        : 'The original payment resolved through a status inquiry.'}
                </strong>
                <p>
                  Provider submissions:{' '}
                  {
                    snapshot.provider_attempts.filter((attempt) => attempt.operation === 'SUBMIT')
                      .length
                  }
                  {' · '}Status inquiries:{' '}
                  {
                    snapshot.provider_attempts.filter(
                      (attempt) => attempt.operation === 'STATUS_INQUIRY',
                    ).length
                  }
                  {replayConfirmed ? ' · Duplicate request returned the same resource.' : ''}
                </p>
                {reversalFlow && snapshot.recovery?.reversal_due_at ? (
                  <div className="policy-clock">
                    <span>
                      Accelerated T+5 demo clock
                      <strong>{formatClock(snapshot.recovery.reversal_due_at)}</strong>
                    </span>
                    <span>
                      Complaint demo eligibility
                      <strong>
                        {snapshot.recovery.complaint_eligible_at
                          ? formatClock(snapshot.recovery.complaint_eligible_at)
                          : 'Not started'}
                      </strong>
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
            <code>{snapshot.fraud_case?.case_id ?? snapshot.payment.payment_intent_id}</code>
          </section>
        ) : null}

        {error ? <p className="error-message">{error} Retry uses the same safe run ID.</p> : null}

        <button
          type="button"
          className={
            scenario === 'refund-collect' || graphFlow
              ? 'primary-action risk-action'
              : recoveryFlow
                ? 'primary-action pending-action'
                : 'primary-action'
          }
          onClick={() => void inspectJourney()}
          disabled={status === 'running' || status === 'recovering'}
        >
          {status === 'running'
            ? 'Evaluating all three lenses…'
            : snapshot && !pending
              ? 'Reset this scenario'
              : snapshot && recoveryFlow
                ? replayConfirmed
                  ? 'Replay confirmed · one submission only'
                  : 'Retry same request safely'
                : status === 'failed'
                  ? 'Retry safely'
                  : scenario === 'refund-collect'
                    ? 'Inspect refund request'
                    : graphFlow
                      ? 'Inspect network risk'
                      : recoveryFlow
                        ? 'Submit once securely'
                        : 'Continue securely'}
        </button>
        {(timeoutFlow ? pending && replayConfirmed : reversalFlow && recoverable) ? (
          <button
            type="button"
            className="secondary-action"
            onClick={() => void recoverJourney()}
            disabled={status === 'recovering'}
          >
            {status === 'recovering'
              ? 'Checking the original provider status…'
              : reversalPending
                ? 'Confirm reversal on original reference'
                : reversalFlow
                  ? 'Start reversal monitoring'
                  : 'Run status-first recovery'}
          </button>
        ) : null}
        <p className="foundation-note">
          Fixed synthetic scenario · partner signing material remains server-side and is never
          shipped to this browser.
        </p>
      </section>
    </main>
  );
}
