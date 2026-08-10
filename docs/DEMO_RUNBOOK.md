# Demo runbook

## Foundation smoke test

1. Copy `.env.example` to `.env` and replace the demo secret.
2. Run `corepack enable`, `pnpm install`, and `pnpm verify`.
3. Start local infrastructure with `pnpm infra:up`.
4. Run `pnpm dev`.
5. Confirm API `/health/live`, PSP sandbox `/health/live`, and both Vite shells.

## Golden checkpoint target

The primary scripted path is a synthetic ₹249 payment to Aarav Electronics from a known demo device. Expected three-eye scores are 8/6/4 and the decision is `ALLOW`. Phase 1 adds one provider submission, signed success callback, durable monotonic state events, and live operations-console rendering.

Never imply that the demo accesses NPCI, a bank, a real UPI account, or a UPI PIN.
