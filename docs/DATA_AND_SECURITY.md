# Data and security

- Synthetic data only. Do not commit real names tied to real payment identifiers, raw VPAs, bank references, phone numbers, credentials, or UPI PIN material.
- Partner writes require HMAC signing, clock validation, nonce replay protection, idempotency, strict schema validation, and bounded body size.
- Production credentials must come from an approved secret manager. `.env` is local-only and ignored.
- Logs redact signatures, partner keys, authorisation headers, secrets, raw VPAs, and PIN-shaped fields.
- Tenant ID is part of every durable lookup and uniqueness boundary.
- Graph queries are tenant-, hop-, time-, and node-bounded.
- Default degradation is visible step-up/block according to policy, never silent allow.
- Unknown/pending provider outcomes are status-checked before any controlled retry.
- Payment state, audit, and outbox events are append-only to the application role in the production design.

This hackathon repository demonstrates production-shaped boundaries but is not a certified payment system and does not process real money.
