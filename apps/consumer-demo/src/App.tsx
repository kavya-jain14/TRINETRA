import { useState } from 'react';

import type { DemoPaymentSnapshot, DemoScenario } from '@trinetra/contracts';

import { runDemoScenario } from './demo-api';

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
} as const;

export function App() {
  const [scenario, setScenario] = useState<ScenarioKey>('trusted-payment');
  const [runId, setRunId] = useState(nextRunId);
  const [snapshot, setSnapshot] = useState<DemoPaymentSnapshot | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const selected = journey[scenario];
  const blocked = snapshot?.assessment.decision === 'BLOCK';

  function reset(nextScenario = scenario) {
    setScenario(nextScenario);
    setRunId(nextRunId());
    setSnapshot(null);
    setStatus('idle');
    setError(null);
  }

  async function inspectJourney() {
    if (snapshot) {
      reset();
      return;
    }

    setStatus('running');
    setError(null);
    try {
      const result = await runDemoScenario(scenario, runId);
      setSnapshot(result);
      setStatus('completed');
    } catch (caught) {
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'TRINETRA demo request failed.');
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
        </div>
      </div>

      <section
        className={
          scenario === 'refund-collect' ? 'panel payment-card risk-flow' : 'panel payment-card'
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
            className={blocked ? 'payment-result is-blocked' : 'payment-result'}
            aria-live="polite"
          >
            <div className="result-state">
              <span className="status-dot" aria-hidden="true" />
              {blocked ? 'Payment blocked before submission' : 'Payment succeeded'}
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
            <code>{snapshot.fraud_case?.case_id ?? snapshot.payment.payment_intent_id}</code>
          </section>
        ) : null}

        {error ? <p className="error-message">{error} Retry uses the same safe run ID.</p> : null}

        <button
          type="button"
          className={
            scenario === 'refund-collect' ? 'primary-action risk-action' : 'primary-action'
          }
          onClick={() => void inspectJourney()}
          disabled={status === 'running'}
        >
          {status === 'running'
            ? 'Evaluating all three lenses…'
            : snapshot
              ? 'Reset this scenario'
              : status === 'failed'
                ? 'Retry safely'
                : scenario === 'refund-collect'
                  ? 'Inspect refund request'
                  : 'Continue securely'}
        </button>
        <p className="foundation-note">
          Fixed synthetic scenario · partner signing material remains server-side and is never
          shipped to this browser.
        </p>
      </section>
    </main>
  );
}
