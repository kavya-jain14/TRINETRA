import { useState } from 'react';

import type { DemoPaymentSnapshot } from '@trinetra/contracts';

import { runTrustedPayment } from './demo-api';

function nextRunId(): string {
  return `run_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function App() {
  const [runId, setRunId] = useState(nextRunId);
  const [snapshot, setSnapshot] = useState<DemoPaymentSnapshot | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'succeeded' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function continueSecurely() {
    if (snapshot) {
      setRunId(nextRunId());
      setSnapshot(null);
      setStatus('idle');
      setError(null);
      return;
    }

    setStatus('running');
    setError(null);
    try {
      const result = await runTrustedPayment(runId);
      setSnapshot(result);
      setStatus('succeeded');
    } catch (caught) {
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'TRINETRA demo request failed.');
    }
  }

  return (
    <main className="app-shell consumer-shell">
      <div className="eyebrow">TRINETRA / Synthetic journey</div>
      <section className="panel payment-card" aria-labelledby="payment-title">
        <div className="merchant-mark" aria-hidden="true">
          AE
        </div>
        <p className="muted">Paying</p>
        <h1 id="payment-title">Aarav Electronics</h1>
        <div className="amount">₹249</div>

        <dl className="payment-facts">
          <div>
            <dt>Receiver match</dt>
            <dd>Verified in synthetic fixture</dd>
          </div>
          <div>
            <dt>Device context</dt>
            <dd>Known demo device</dd>
          </div>
        </dl>

        {snapshot ? (
          <section className="payment-result" aria-live="polite">
            <div className="result-state">
              <span className="status-dot" aria-hidden="true" /> Payment succeeded
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
            <code>{snapshot.payment.payment_intent_id}</code>
          </section>
        ) : null}

        {error ? <p className="error-message">{error} Retry uses the same safe run ID.</p> : null}

        <button
          type="button"
          onClick={() => void continueSecurely()}
          disabled={status === 'running'}
        >
          {status === 'running'
            ? 'Evaluating and submitting…'
            : snapshot
              ? 'Prepare another demo payment'
              : status === 'failed'
                ? 'Retry safely'
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
