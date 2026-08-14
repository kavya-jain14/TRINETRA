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
- Operations console: Vite prints its local URL
- Consumer demo: Vite prints its local URL

Run the complete local quality gate with `pnpm verify`.

## Repository map

See [Architecture](docs/ARCHITECTURE.md), [API and events](docs/API_AND_EVENTS.md),
[Package 0B payment ledger](docs/PAYMENT_LEDGER_0B.md), and
[team workflow](docs/TEAM_WORKFLOW.md). The full locked product plan is in
[the master blueprint](docs/MASTER_BLUEPRINT.md).

## First integration checkpoint

Consumer demo creates a synthetic ₹249 trusted-merchant intent → API returns three low scores and `ALLOW` → PSP sandbox returns signed success → operations console displays one immutable payment timeline.

The backend now implements and tests this decision-to-ledger-to-provider flow. Package 0C wires
the operations and consumer interfaces to the published contracts.
