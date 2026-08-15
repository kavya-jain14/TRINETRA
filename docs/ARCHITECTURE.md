# Architecture

## Locked shape

TRINETRA is a TypeScript modular monolith with separate deployable processes for the API, worker, operations console, consumer demo, and deterministic PSP sandbox.

```text
partner boundary
  -> Fastify API
      -> contracts
      -> risk-core / graph-core / payment-core / case-core
      -> PostgreSQL transaction + outbox
  -> BullMQ workers through Redis
      -> recovery, reconciliation, signed webhooks
  -> React operations and consumer applications
```

PostgreSQL is durable transactional truth. Redis stores only short-lived nonces, velocity windows, bounded features, rate-limit counters, and BullMQ state. No Redis value is the sole record of a payment outcome.

Outbox rows remain unpublished until the worker receives a successful response from the configured
partner webhook. Delivery is at-least-once across the unavoidable post-send/pre-commit crash window;
the stable delivery key makes receiver-side deduplication mandatory. `REVERSAL_PENDING` payments
keep status polling on the original provider reference until a terminal reversal is recorded.

## Three risk lenses

- NETRA-I Identity: device/session/customer consistency.
- NETRA-II Intent: whether the operation matches the user's stated goal.
- NETRA-III Integrity: receiver, merchant, remote-access, and bounded graph evidence.

The deterministic engine produces all three integer scores, an ordered reason list, a rule-set version, an expiry, and one final `ALLOW`, `WARN`, `STEP_UP`, or `BLOCK` decision.

## Payment safety

State transitions originate in `packages/payment-core`. `PENDING` is an unresolved state, not a
retry instruction. `packages/database` implements the port with row locks, optimistic resource
versions, append-only state/provider events, tenant-scoped keys, and a transactional outbox.
Provider callbacks are signed and idempotent; old callbacks cannot move a payment backward.

## Fraud case boundary

`packages/case-core` converts a `BLOCK` assessment into one idempotent, evidence-backed case. The
PostgreSQL adapter resolves the payment inside the tenant boundary and commits `cases`,
`case_events`, and `case.created` outbox rows in one transaction. Case evidence is derived from the
published assessment reasons through a fixed reason-to-lens definition; route handlers and React
code do not invent analyst meaning. The in-memory case repository exists only for isolated tests.

## Golden-flow demo boundary

The consumer and operations applications never hold a partner HMAC secret. In explicit local demo
mode, Fastify exposes two fixed synthetic scenario commands and read-only durable timeline views.
Each command accepts only an opaque run ID, uses the same risk, payment, and case services as
partner routes, and cannot select arbitrary amounts, payees, tenants, or provider behaviours.
Production configuration rejects demo mode. The operations console polls PostgreSQL-backed
snapshots, so a refresh or another API replica observes the same payment and case state.

## Module boundary rule

Fastify handlers validate, authenticate, call application/domain services, and map responses. They do not contain scoring predicates or payment-transition tables. UI code consumes published contracts and never infers canonical states from provider text.

## Adapter boundary

The API process uses PostgreSQL in the runnable server and an explicitly labelled in-memory ledger
only when `buildApp` is used by isolated tests. The deterministic PSP adapter is synthetic and
implements submit/status behavior behind a provider port. External provider work never occurs
inside a database transaction. Readiness reports the active persistence adapter honestly.
