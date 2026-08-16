<<<<<<< HEAD
# 🎭 TRINETRA 4-Minute Judge Demo Runbook

**Goal:** Present end-to-end deceptive debit prevention, real-time risk challenge UX, and RBI-aligned recovery in under 240 seconds.

---

## ⏱️ Timeline & Choreography

### 0:00 – 0:45 | Scenario A & Baseline (Trusted Everyday)
1. Select **Scenario A** on the top bar.
2. Point out: Risk Score `12/100 (ALLOW)`. Known device, merchant, and prior history.
3. Click **Proceed to Authorise Payment**.
4. **Key Talking Point:** *"TRINETRA operates silently in the background for low-risk transactions without adding friction."*

### 0:45 – 1:30 | Scenario B & Bypassing Deceptive Collect (BLOCK)
1. Select **Scenario B** on the top bar.
2. Highlight: Deceptive **Receive Refund** UI toggle vs. underlying **DEBIT** collect request, combined with active remote-access flag.
3. Click **Proceed to Authorise Payment**.
4. Show the **Risk Warning Modal**: Highlight plain-language intent conflict + NPCI anti-scam notice.
5. Click **Cancel Payment (Safe)** and demonstrate safe exit modal.
6. **Key Talking Point:** *"TRINETRA intercepts deceptive intent conflicts before the user enters their UPI PIN."*

### 1:30 – 2:15 | Scenario C & QR Mismatch (STEP_UP)
1. Select **Scenario C**.
2. Point out: Display name is **Metro Café**, but resolved VPA token is `scammer99@vpa`.
3. Click **Proceed to Authorise Payment**.
4. Show Step-Up verification: Type `scammer99@vpa` into the input box to prove identity verification.
5. **Key Talking Point:** *"Instead of hard blocking, TRINETRA steps up verification for QR and payee mismatches."*

### 2:15 – 3:00 | Scenario D & Graph Evidence (Mule Network)
1. Select **Scenario D**.
2. Show the **Mule Graph Evidence** panel: Point out the 2-hop connection to synthetic identity cases.
3. **Key Talking Point:** *"Multi-hop graph analytics detect synthetic mule networks even when the direct receiver seems new."*

### 3:00 – 4:00 | Scenarios E & F: Recovery Center (RBI T+5 Clock & ODR)
1. Select **Scenario E**. Click **Proceed to Authorise Payment** to trigger timeout / pending state.
2. Switch to **Recovery & Disputes** tab:
   - Click **Perform Status Inquiry** to show idempotency locking preventing double debits.
3. Show **Scenario F**: Point out the **RBI T+5 Days Auto-Reversal Clock** and ₹100/day compensation counter.
4. Type a grievance comment and click **File Official ODR Dispute**. Show generated `DISP-2026-XXXX` reference code.
5. **Key Talking Point:** *"When transactions stall, TRINETRA provides transparent ODR recovery aligned with RBI auto-reversal guidelines."*
=======
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

Never imply that the demo accesses NPCI, a bank, a real UPI account, or a UPI PIN.
>>>>>>> origin/main
