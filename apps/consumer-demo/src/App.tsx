import { useState } from 'react';

import type { DemoPaymentSnapshot, DemoScenario } from '@trinetra/contracts';

import { recoverTimeoutScenario, runDemoScenario } from './demo-api';

type ScenarioKey = DemoScenario['key'];

function nextRunId(): string {
  return `run_${crypto.randomUUID().replaceAll('-', '')}`;
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
  const timeoutFlow = scenario === 'timeout-recovery';

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
      if (snapshot && timeoutFlow) setReplayConfirmed(true);
      setStatus('completed');
    } catch (caught) {
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'TRINETRA demo request failed.');
    }
  }

  async function recoverJourney() {
    setStatus('recovering');
    setError(null);
    try {
      setSnapshot(await recoverTimeoutScenario(runId));
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
        </div>
      </div>

      <section
        className={
          scenario === 'refund-collect'
            ? 'panel payment-card risk-flow'
            : timeoutFlow
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
                : pending
                  ? 'payment-result is-pending'
                  : 'payment-result'
            }
            aria-live="polite"
          >
            <div className="result-state">
              <span className="status-dot" aria-hidden="true" />
              {blocked
                ? 'Payment blocked before submission'
                : pending
                  ? 'Payment pending—not failed'
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
                <strong>This request would send money—not receive a refund.</strong>
                <ul>
                  {snapshot.assessment.reasons.map((reason) => (
                    <li key={reason.code}>{reason.user_message}</li>
                  ))}
                </ul>
                <p>
                  Safe action: close the request and contact the organisation through its official
                  channel. No provider submission was made.
                </p>
              </div>
            ) : null}
            {timeoutFlow ? (
              <div className="safety-explanation recovery-explanation">
                <strong>
                  {pending
                    ? 'Do not create another payment—the original provider reference is preserved.'
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
              </div>
            ) : null}
            <code>{snapshot.fraud_case?.case_id ?? snapshot.payment.payment_intent_id}</code>
          </section>
        ) : null}

        {error ? <p className="error-message">{error} Retry uses the same safe run ID.</p> : null}

        <button
          type="button"
          className={
            scenario === 'refund-collect'
              ? 'primary-action risk-action'
              : timeoutFlow
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
              : snapshot && timeoutFlow
                ? replayConfirmed
                  ? 'Replay confirmed · one submission only'
                  : 'Retry same request safely'
                : status === 'failed'
                  ? 'Retry safely'
                  : scenario === 'refund-collect'
                    ? 'Inspect refund request'
                    : timeoutFlow
                      ? 'Submit once securely'
                      : 'Continue securely'}
        </button>
        {timeoutFlow && pending && replayConfirmed ? (
          <button
            type="button"
            className="secondary-action"
            onClick={() => void recoverJourney()}
            disabled={status === 'recovering'}
          >
            {status === 'recovering'
              ? 'Checking the original provider status…'
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
