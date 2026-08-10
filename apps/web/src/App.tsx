const lensScores = [
  { label: 'NETRA-I · Identity', score: 8, note: 'Known synthetic device' },
  { label: 'NETRA-II · Intent', score: 6, note: 'Merchant payment matches goal' },
  { label: 'NETRA-III · Integrity', score: 4, note: 'Receiver and merchant agree' },
];

const timeline = [
  ['12:00:00', 'Intent received', 'CREATED'],
  ['12:00:00', 'Three-eye assessment complete', 'ALLOW'],
  ['Next slice', 'Provider submission and ledger event', 'PENDING'],
];

export function App() {
  return (
    <main className="app-shell command-center">
      <header className="topbar">
        <div>
          <div className="eyebrow">TRINETRA / Operations</div>
          <h1>Payment risk, without the blind spots.</h1>
        </div>
        <div className="foundation-status">
          <span className="status-dot" aria-hidden="true" /> Phase 0A online
        </div>
      </header>

      <section className="decision-grid" aria-label="Trusted merchant decision preview">
        <article className="panel decision-card">
          <span className="decision-label">Decision</span>
          <strong>ALLOW</strong>
          <p>₹249 · Aarav Electronics · synthetic fixture</p>
        </article>
        {lensScores.map((lens) => (
          <article className="panel lens-card" key={lens.label}>
            <span>{lens.label}</span>
            <strong>{lens.score}</strong>
            <p>{lens.note}</p>
          </article>
        ))}
      </section>

      <section className="panel timeline-panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Immutable timeline</div>
            <h2>Golden payment checkpoint</h2>
          </div>
          <span className="contract-chip">Live contract wiring: Package 0C</span>
        </div>
        <div className="timeline-list" role="list">
          {timeline.map(([time, event, state]) => (
            <div className="timeline-row" role="listitem" key={event}>
              <time>{time}</time>
              <span>{event}</span>
              <strong>{state}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
