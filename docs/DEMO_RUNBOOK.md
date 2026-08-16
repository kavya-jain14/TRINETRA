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

## Timeout recovery checkpoint

1. Select **Safe recovery** in the consumer demo and submit the fixed ₹786 utilities payment.
2. Confirm the initial state is `PENDING`, not failed, with one `SUBMIT / UNKNOWN /
TIMEOUT_UNKNOWN` provider attempt.
3. Select **Retry same request safely** and confirm the payment ID is unchanged and the provider
   submission count remains exactly one.
4. Select **Run status-first recovery**. Confirm one `STATUS_INQUIRY` appears and the original
   payment becomes `SUCCEEDED`.
5. In operations, confirm the timeline is `CREATED → RISK_EVALUATING → ALLOWED → SUBMITTED →
PENDING → SUCCEEDED`, the recovery clock is resolved, and no second `SUBMIT` exists.
6. Refresh or repeat the recovery action: the terminal resource and two attempt records must remain
   unchanged.

## Reversal watch checkpoint

1. Select **Reversal watch** and submit the fixed ₹425 Harbor Cafe Demo payment.
2. Confirm `PENDING` with exactly one `SUBMIT / COMPLETED / PENDING` attempt. The consumer must say
   not to pay again.
3. Select **Start reversal monitoring**. Confirm `REVERSAL_PENDING`, one `STATUS_INQUIRY`, and
   populated reversal/complaint timestamps labelled as accelerated demo clocks.
4. Select **Confirm reversal on original reference**. Confirm `REVERSED`, two status inquiries, and
   still exactly one provider submission.
5. In operations, confirm `CREATED → RISK_EVALUATING → ALLOWED → SUBMITTED → PENDING →
REVERSAL_PENDING → REVERSED`, with the original provider reference and resolved recovery clock.
6. Repeat the terminal recovery call. Payment version, timeline, and three provider attempts must
   remain unchanged.
7. State the boundary accurately: the partner bank or PSP executes the actual reversal under the
   applicable timeline; TRINETRA monitors it and the prototype clock is accelerated.

## Bounded graph-risk checkpoint

1. Select **Network risk** and inspect the fixed ₹649 Orchid Supplies Demo payment.
2. Confirm the destination is a tokenised reference; no raw VPA appears in the browser or analyst
   evidence.
3. Run the scenario and confirm NETRA-III is 92, graph contribution is 75, decision is `BLOCK`, and
   the payment timeline is `CREATED → RISK_EVALUATING → BLOCKED`.
4. Confirm there is no provider reference and zero provider attempts.
5. In operations, confirm six nodes and five edges: destination → shared-device cluster → two
   confirmed synthetic cases, with two additional synthetic customers linked to the cluster.
6. Confirm the topology states two hops, at most 250 nodes, a 90-day evidence window, and no
   truncation for this fixture.
7. Open the `HIGH / RISK_REVIEW` case and confirm `GRAPH_LINKED_DESTINATION` appears as NETRA-III
   evidence.
8. Repeat the same run ID and confirm the payment and case IDs are unchanged and the provider
   submission count remains zero.
9. State the boundary accurately: association is a bounded review signal, not proof of guilt.

Never imply that the demo accesses NPCI, a bank, a real UPI account, or a UPI PIN.
