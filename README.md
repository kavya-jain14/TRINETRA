# TRINETRA

TRINETRA is an explainable control layer for UPI partners. It combines three pre-authorisation risk lenses—Identity, Intent, and Integrity—with a state-safe payment ledger and recovery orchestrator.

This repository is a synthetic-only SIH prototype. It does not connect to NPCI or a bank, handle UPI PINs, move real money, or claim production fraud accuracy.

## Foundation status

Phase 0A establishes:

- React/Vite operations and consumer shells;
- Fastify API and deterministic PSP sandbox shells;
- Zod contracts and generated OpenAPI document;
- partner HMAC signing, timestamp, nonce, and idempotency boundaries;
- deterministic three-eye risk decision and payment-state machine packages;
- Drizzle/PostgreSQL schema start, Redis/BullMQ worker shell, and Docker Compose;
- CI, CODEOWNERS, PR template, security check, and team workflow.

## Quick start

Prerequisites: Node.js 22.12+ (24 recommended), Corepack, pnpm 11.16+, and Docker.

```bash
cp .env.example .env
corepack enable
pnpm install
pnpm infra:up
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

See [Architecture](docs/ARCHITECTURE.md), [API and events](docs/API_AND_EVENTS.md), and [team workflow](docs/TEAM_WORKFLOW.md). The full locked product plan is in [the master blueprint](docs/MASTER_BLUEPRINT.md).

## First integration checkpoint

Consumer demo creates a synthetic ₹249 trusted-merchant intent → API returns three low scores and `ALLOW` → PSP sandbox returns signed success → operations console displays one immutable payment timeline.

The current foundation implements and tests the secure decision boundary. Durable ledger submission and live UI wiring follow in Packages 0B/0C and Phase 1.
