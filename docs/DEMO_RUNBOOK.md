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