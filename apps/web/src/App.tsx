import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DemoPaymentSnapshot, FraudCaseSnapshot } from '@trinetra/contracts';

import { loadDemoOperations } from './demo-api';

function formatAmount(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function App() {
  const [payments, setPayments] = useState<DemoPaymentSnapshot[]>([]);
  const [cases, setCases] = useState<FraudCaseSnapshot[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'live' | 'degraded'>('loading');
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const snapshot = await loadDemoOperations(signal);
      setPayments(snapshot.payments);
      setCases(snapshot.cases);
      setSelectedPaymentId(
        (current) => current ?? snapshot.payments[0]?.payment.payment_intent_id ?? null,
      );
      setStatus('live');
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setStatus('degraded');
      setError(caught instanceof Error ? caught.message : 'Live operations data is unavailable.');
    } finally {
      refreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => void refresh(), 2_500);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  const selected = useMemo(
    () =>
      payments.find((payment) => payment.payment.payment_intent_id === selectedPaymentId) ??
      payments[0] ??
      null,
    [payments, selectedPaymentId],
  );
  const selectedCase = useMemo(
    () =>
      cases.find(
        (fraudCase) => fraudCase.payment_intent_id === selected?.payment.payment_intent_id,
      ) ??
      selected?.fraud_case ??
      null,
    [cases, selected],
  );
  const lensScores = selected
    ? [
        {
          label: 'NETRA-I · Identity',
          score: selected.assessment.subscores.identity,
          note: 'Device and request trust',
        },
        {
          label: 'NETRA-II · Intent',
          score: selected.assessment.subscores.intent,
          note: 'Behaviour and payment intent',
        },
        {
          label: 'NETRA-III · Integrity',
          score: selected.assessment.subscores.integrity,
          note: 'Receiver and context integrity',
        },
      ]
    : [];

  return (
    <main className="app-shell command-center">
      <header className="topbar">
        <div>
          <div className="eyebrow">TRINETRA / Operations</div>
          <h1>Payment risk, without the blind spots.</h1>
        </div>
        <div className={`foundation-status status-${status}`}>
          <span className="status-dot" aria-hidden="true" />
          {status === 'loading' ? 'Connecting' : status === 'live' ? 'Live backend' : 'Degraded'}
        </div>
      </header>

      {error ? (
        <div className="error-banner" role="alert">
          {error} Retrying automatically.
        </div>
      ) : null}

      {selected ? (
        <>
          <section className="decision-grid" aria-label="Live payment decision">
            <article
              className={
                selected.assessment.decision === 'BLOCK'
                  ? 'panel decision-card decision-blocked'
                  : 'panel decision-card'
              }
            >
              <span className="decision-label">Decision</span>
              <strong>{selected.assessment.decision}</strong>
              <p>
                {formatAmount(selected.scenario.amount_paise)} ·{' '}
                {selected.scenario.counterparty_name} · {selected.payment.state}
              </p>
              <small>
                {selected.provider_attempts.length === 0
                  ? 'No provider submission'
                  : `${selected.provider_attempts.length} provider attempt`}
              </small>
            </article>
            {lensScores.map((lens) => (
              <article className="panel lens-card" key={lens.label}>
                <span>{lens.label}</span>
                <strong>{lens.score}</strong>
                <p>{lens.note}</p>
              </article>
            ))}
          </section>

          <div className="operations-grid">
            <section className="panel stream-panel" aria-labelledby="stream-title">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">Live transaction stream</div>
                  <h2 id="stream-title">Synthetic partner activity</h2>
                </div>
                <button type="button" className="refresh-button" onClick={() => void refresh()}>
                  Refresh
                </button>
              </div>
              <div className="transaction-list">
                {payments.map((payment) => (
                  <button
                    type="button"
                    className={
                      payment.payment.payment_intent_id === selected.payment.payment_intent_id
                        ? 'transaction-row is-selected'
                        : 'transaction-row'
                    }
                    key={payment.payment.payment_intent_id}
                    onClick={() => setSelectedPaymentId(payment.payment.payment_intent_id)}
                  >
                    <span>{payment.scenario.counterparty_name}</span>
                    <code>{payment.payment.payment_intent_id.slice(0, 18)}…</code>
                    <strong className={`decision-${payment.assessment.decision.toLowerCase()}`}>
                      {payment.assessment.decision}
                    </strong>
                    <span>{payment.payment.state}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel case-queue" aria-labelledby="case-queue-title">
              <div className="eyebrow">Analyst queue</div>
              <h2 id="case-queue-title">Open fraud cases</h2>
              {cases.length > 0 ? (
                <div className="case-list">
                  {cases.map((fraudCase) => (
                    <button
                      type="button"
                      key={fraudCase.case_id}
                      className={
                        fraudCase.case_id === selectedCase?.case_id
                          ? 'case-row is-selected'
                          : 'case-row'
                      }
                      onClick={() => setSelectedPaymentId(fraudCase.payment_intent_id)}
                    >
                      <span>
                        <strong>{fraudCase.severity}</strong>
                        {fraudCase.status}
                      </span>
                      <code>{fraudCase.case_id.slice(0, 22)}…</code>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">No blocked demo case yet.</p>
              )}
            </section>
          </div>

          {selectedCase ? (
            <section className="panel investigation-panel" aria-labelledby="investigation-title">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">Investigation case</div>
                  <h2 id="investigation-title">Evidence, not a black-box label</h2>
                </div>
                <div className="case-meta">
                  <strong>{selectedCase.status}</strong>
                  <span>{selectedCase.severity}</span>
                  <code>{selectedCase.case_id}</code>
                </div>
              </div>
              <p className="case-summary">{selectedCase.summary}</p>
              <div className="evidence-list">
                {selectedCase.evidence.map((evidence) => (
                  <article className="evidence-row" key={evidence.code}>
                    <div>
                      <span>{evidence.lens}</span>
                      <strong>{evidence.code.replaceAll('_', ' ')}</strong>
                    </div>
                    <p>{evidence.analyst_detail}</p>
                    <code>{evidence.evidence_ref}</code>
                    <b>{evidence.impact}</b>
                  </article>
                ))}
              </div>
              <div className="case-timeline" role="list">
                {selectedCase.timeline.map((event) => (
                  <div className="timeline-row" role="listitem" key={event.event_id}>
                    <time dateTime={event.occurred_at}>{formatTime(event.occurred_at)}</time>
                    <span>{event.source.replaceAll('_', ' ')}</span>
                    <strong>{event.event_type}</strong>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="panel timeline-panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Immutable payment timeline</div>
                <h2>
                  {selected.scenario.key === 'refund-collect'
                    ? 'Blocked before provider boundary'
                    : 'Golden payment checkpoint'}
                </h2>
              </div>
              <span className="contract-chip">
                v{selected.payment.resource_version} · {selected.assessment.trace_id}
              </span>
            </div>
            <div className="timeline-list" role="list">
              {selected.timeline.map((event) => (
                <div className="timeline-row" role="listitem" key={event.event_id}>
                  <time dateTime={event.occurred_at}>{formatTime(event.occurred_at)}</time>
                  <span>{event.source.replaceAll('_', ' ')}</span>
                  <strong>{event.to_state}</strong>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="panel empty-state">
          <div className="eyebrow">Awaiting first event</div>
          <h2>No demo payment yet.</h2>
          <p>Open the consumer demo on port 5174 and run either fixed scenario.</p>
        </section>
      )}
    </main>
  );
}
