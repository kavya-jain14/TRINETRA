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

## Three risk lenses

- NETRA-I Identity: device/session/customer consistency.
- NETRA-II Intent: whether the operation matches the user's stated goal.
- NETRA-III Integrity: receiver, merchant, remote-access, and bounded graph evidence.

The deterministic engine produces all three integer scores, an ordered reason list, a rule-set version, an expiry, and one final `ALLOW`, `WARN`, `STEP_UP`, or `BLOCK` decision.

## Payment safety

State transitions originate in `packages/payment-core`. `PENDING` is an unresolved state, not a retry instruction. Provider callbacks must be signed and idempotent; old callbacks cannot move a payment backward. Durable changes will commit the state event and outbox event atomically.

## Module boundary rule

Fastify handlers validate, authenticate, call application/domain services, and map responses. They do not contain scoring predicates or payment-transition tables. UI code consumes published contracts and never infers canonical states from provider text.

## Foundation adapter boundary

Phase 0A uses process-memory nonce and idempotency adapters so contract tests run without infrastructure. Package 0B replaces those adapters with Redis/PostgreSQL implementations without changing the endpoint contract. Readiness reports the active adapter honestly.
