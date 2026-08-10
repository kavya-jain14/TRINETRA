export function App() {
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

        <button type="button" disabled title="Live API wiring lands in Package 0C">
          Continue securely
        </button>
        <p className="foundation-note">
          UI foundation only · signed partner calls stay server-side and never expose the demo
          secret.
        </p>
      </section>
    </main>
  );
}
