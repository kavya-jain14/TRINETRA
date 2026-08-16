# Data and security

- Synthetic data only. Do not commit real names tied to real payment identifiers, raw VPAs, bank references, phone numbers, credentials, or UPI PIN material.
- Partner writes require HMAC signing, clock validation, nonce replay protection, idempotency, strict schema validation, and bounded body size. Runtime nonce consumption uses an atomic Redis `SET NX PX` operation with hashed keys so replay protection survives restarts and works across API replicas. The bounded in-memory store is test-only.
- Device trust is supplied as explicit partner-side context and matched against an exact synthetic allow-list at the API boundary; token substrings never imply trust. Payee-name comparisons apply Unicode, whitespace, and case normalization before mismatch rules run.
- Production credentials must come from an approved secret manager. `.env` is local-only and ignored.
- Logs redact signatures, partner keys, authorisation headers, secrets, raw VPAs, and PIN-shaped fields.
- Tenant ID is part of every durable lookup and uniqueness boundary.
- Fraud cases reference the tenant-scoped payment key; one payment can open at most one case, and
  case identity cannot be rebound to another payment. Case evidence stores stable reason codes,
  analyst definitions, and bounded references—not cleartext receiver identity or raw VPA data.
- Graph queries are tenant-scoped and capped at two hops, 250 returned nodes, 500 eligible edges,
  and a 90-day evidence window. Expired intermediate nodes and edges are excluded before risk is
  calculated.
- Graph equality joins use tokenised synthetic references in the prototype. No raw VPA is stored or
  returned, token text never implies risk, and network association is treated as a signal rather
  than proof of guilt.
- A graph traversal that reaches a configured cap produces a visible step-up reason instead of a
  silent allow.
- Default degradation is visible step-up/block according to policy, never silent allow.
- Unknown/pending provider outcomes are status-checked before any controlled retry.
- Payment state, case, audit, and outbox events are append-only to the application role in the production design.

This hackathon repository demonstrates production-shaped boundaries but is not a certified payment system and does not process real money.
