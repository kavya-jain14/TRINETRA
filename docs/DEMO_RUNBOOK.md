# Demo runbook

## Foundation smoke test

1. Copy `.env.example` to `.env` and replace the demo secret.
2. Run `corepack enable`, `pnpm install`, and `pnpm verify`.
3. Start local infrastructure with `pnpm infra:up`.
4. Run `pnpm dev`.
5. Confirm API `/health/live`, PSP sandbox `/health/live`, and both Vite shells.

## Golden checkpoint

1. Select **Trusted payment** in the consumer demo.
2. Run the synthetic ₹249 payment to Aarav Electronics from the known demo device.
3. Confirm scores 8/6/4, decision `ALLOW`, final state `SUCCEEDED`, and one provider attempt.
4. Confirm the operations console shows `CREATED → RISK_EVALUATING → ALLOWED → SUBMITTED → SUCCEEDED`.

## Blocked refund checkpoint

1. Select **Refund trap** in the consumer demo.
2. Inspect the fixed ₹1,999 request claiming that approval is required to receive a refund.
3. Confirm reasons `REMOTE_ACCESS_ACTIVE`, `REFUND_COLLECT_CONFLICT`, and `NEW_BENEFICIARY`.
4. Confirm decision `BLOCK`, state `BLOCKED`, no provider reference, and zero provider attempts.
5. Confirm the consumer explains that collect sends money and offers a safe cancel/contact action.
6. Open the operations console and select the `CRITICAL / OPEN` case.
7. Confirm all three ordered evidence items, bounded evidence references, `case.created`, and the
   `CREATED → RISK_EVALUATING → BLOCKED` payment timeline.
8. Retry the same run only when testing idempotency: the payment and case IDs must remain unchanged.

Never imply that the demo accesses NPCI, a bank, a real UPI account, or a UPI PIN.
