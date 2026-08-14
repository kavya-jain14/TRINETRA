# Architecture

## Locked shape

TRINETRA is a TypeScript modular monolith with separate deployable processes for the API, worker, operations console, consumer demo, and deterministic PSP sandbox.

```text
partner boundary
  -> Fastify API
      -> contracts
      -> risk-core / graph-core / payment-core
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

## Module boundary rule

Fastify handlers validate, authenticate, call application/domain services, and map responses. They do not contain scoring predicates or payment-transition tables. UI code consumes published contracts and never infers canonical states from provider text.

## Adapter boundary

The API process uses PostgreSQL in the runnable server and an explicitly labelled in-memory ledger
only when `buildApp` is used by isolated tests. The deterministic PSP adapter is synthetic and
implements submit/status behavior behind a provider port. External provider work never occurs
inside a database transaction. Readiness reports the active persistence adapter honestly.
