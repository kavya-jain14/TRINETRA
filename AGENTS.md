# TRINETRA contributor instructions

## Product doctrine

TRINETRA is a partner-deployed UPI fraud-prevention and payment-resilience gateway. It returns explainable `ALLOW`, `WARN`, `STEP_UP`, or `BLOCK` decisions before authorisation and preserves a monotonic payment-state ledger after submission.

It does not replace UPI, access a UPI PIN, claim direct NPCI connectivity, or process real money in this repository. Demo fixtures must remain synthetic.

## Architecture rules

- Keep the MVP a TypeScript modular monolith with independently testable packages and workers.
- Fastify route handlers orchestrate only; scoring and state transitions belong in domain packages.
- Contracts originate in `packages/contracts`; consumers must not invent response shapes.
- PostgreSQL is durable truth. Redis is only for bounded hot features, nonces, rate limits, and jobs.
- Unknown or pending payment states are never blind-retried.
- Payment transitions are monotonic, idempotent, and append an auditable event.
- No raw PII, UPI identifiers, secrets, or high-cardinality sensitive values in logs, tests, or telemetry.
- External calls must not be held inside database transactions.

## Before opening a PR

Run `pnpm verify`. Update the relevant contract/document in the same PR and state API, event, database, security, and rollback impact.

Never push directly to `main`. Architecture, security, payment-state, tenancy, rule-publish, and migration changes require Kavya plus the module owner.
