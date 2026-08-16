# TRINETRA

TRINETRA is an explainable control layer for UPI partners. It combines three pre-authorisation risk lenses—Identity, Intent, and Integrity—with a state-safe payment ledger and recovery orchestrator.

This repository is a synthetic-only SIH prototype. It does not connect to NPCI or a bank, handle UPI PINs, move real money, or claim production fraud accuracy.

## Platform status

Phase 0A establishes the monorepo, contracts, secure partner boundary, deterministic risk engine,
UI shells, CI, and local infrastructure. Package 0B now adds:

- a tenant-scoped PostgreSQL payment-intent and idempotency repository;
- append-only state/provider history and an atomic transactional outbox;
- submit-once deterministic PSP adapter behavior;
- authenticated, idempotent provider callbacks that cannot regress state;
- status-first pending recovery, reversal/complaint clocks, and BullMQ processors;
- a live fixed-scenario consumer journey and polling operations timeline backed by PostgreSQL;
- tenant-scoped fraud cases with append-only evidence events and transactional `case.created` outbox delivery;
- a deceptive refund collect journey that is blocked before the provider boundary and opens a live analyst case;
- an accepted-but-timed-out payment journey that preserves one provider submission, exposes the
  recovery clock, replays the original resource, and resolves through status inquiry;
- repository, domain-property, API integration, and worker recovery tests. CI exercises the signed API against real PostgreSQL 17 and Redis 7.4 services, including cross-replica nonce replay rejection and active readiness checks.

## Quick start

Prerequisites: Node.js 22.12+ (24 recommended), Corepack, pnpm 11.16+, and Docker.

```bash
cp .env.example .env
corepack enable
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm dev
```

Services:

- API: `http://localhost:4000`
- API liveness: `http://localhost:4000/health/live`
- OpenAPI: `http://localhost:4000/openapi.json`
- PSP sandbox: `http://localhost:4100`
- Operations console: `http://localhost:5173`
- Consumer demo: `http://localhost:5174`

With `DEMO_MODE=true` in the local `.env`, open both React apps. Run the fixed ₹249 trusted payment,
the deceptive ₹1,999 refund-collect request, the ₹786 accepted-timeout recovery journey, or the
₹425 merchant-confirmation reversal watch. The
operations console polls the durable payment, recovery, and case timelines. Partner HMAC material
is never sent to either browser. Demo orchestration cannot be enabled when `NODE_ENV=production`.

Run the complete local quality gate with `pnpm verify`.

## Repository map

See [Architecture](docs/ARCHITECTURE.md), [API and events](docs/API_AND_EVENTS.md),
[Package 0B payment ledger](docs/PAYMENT_LEDGER_0B.md), and
[team workflow](docs/TEAM_WORKFLOW.md). The full locked product plan is in
[the master blueprint](docs/MASTER_BLUEPRINT.md).

## First integration checkpoint

Consumer demo creates a synthetic ₹249 trusted-merchant intent → API returns three low scores and
`ALLOW` → deterministic PSP adapter resolves `SUCCESS` → operations console displays one immutable
payment timeline. The signed provider-callback path remains independently covered by API contract
tests.

The backend and Package 0C interfaces now implement this checkpoint against published contracts.
The real PostgreSQL integration test verifies that another API replica can read the same durable
success timeline.

## Second integration checkpoint

Consumer demo inspects a synthetic “receive refund” request → backend detects the debit collect
conflict, new beneficiary, and active remote access → decision is `BLOCK` → payment remains
`BLOCKED` with zero provider attempts → one durable `OPEN` case appears in the analyst queue with
ordered three-lens evidence and immutable case/payment timelines.

Case creation is tenant-scoped and idempotent. PostgreSQL commits the case, its `case.created`
event, and the transactional outbox row together. A real-service integration test verifies that a
second API replica can read the same case and evidence.

## Third integration checkpoint

Consumer demo submits one synthetic ₹786 utilities payment → the provider durably accepts it but
the response times out → TRINETRA records `PENDING`, an `UNKNOWN` submit attempt, and a bounded
recovery clock → repeating the same run returns the original payment with exactly one provider
submission → a status-first recovery inquiry resolves the original provider reference to
`SUCCEEDED`.

The operations console exposes the submit/inquiry evidence and clock without turning `PENDING`
into a retry instruction. The worker uses the same ledger service for scheduled recovery. A
real-service integration test proves that another API replica can replay and recover the payment
through the PostgreSQL-backed synthetic provider state.

## Fourth integration checkpoint

Consumer demo submits one synthetic ₹425 merchant payment → provider acknowledgement leaves the
original resource `PENDING` → the first status inquiry reports `REVERSAL_PENDING` and starts the
accelerated T+5/complaint demo clocks → a second inquiry on the same provider reference records
`REVERSED` → any terminal recovery replay is a no-op.

The consumer explicitly says not to pay again, while operations shows one submission, two status
inquiries, the durable policy-clock evidence, and the complete monotonic timeline. Real regulatory
timing and reversal execution remain the responsibility of the partner bank or PSP; the prototype
only visualizes and monitors them. PostgreSQL/Redis CI proves the two-pulse flow across API replicas.
