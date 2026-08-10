# Package 0B: payment ledger and recovery

## Safety contract

PostgreSQL is the durable payment truth. Redis/BullMQ may schedule work, but a missing Redis job
cannot erase a payment outcome. The ledger enforces these invariants:

1. Payment state changes are monotonic and validated by `@trinetra/payment-core`.
2. A state update, append-only state event, and outbox event share one PostgreSQL transaction.
3. `(tenant_id, operation, idempotency_key)` binds payment-intent creation and submission to one
   canonical request hash. A changed body or payment path conflicts.
4. Submission creates one stable provider request reference. Repeated submit requests return the
   existing payment and never call the provider again.
5. A timeout or unknown response becomes `PENDING`, not `FAILED` and not a retry instruction.
6. Provider callback identity is `(tenant_id, provider, provider_event_id)`. Its payment, provider
   reference, status, amount, and payload hash are immutable; changed content conflicts.
7. Every payment lookup and mutation includes `tenant_id`; composite foreign keys prevent a
   provider/state event from referencing another tenant's payment.

## Durable tables

- `payment_intents`: current projection, canonical request/response, provider reference, and
  optimistic `resource_version`.
- `idempotency_records`: tenant/operation/key binding and replay response.
- `payment_state_events`: immutable transition history with unique event keys.
- `provider_attempts`: submit and status-inquiry attempts; submit is unique per provider request.
- `provider_events`: authenticated callback receipts and applied/stale outcome evidence.
- `payment_recovery_clocks`: bounded status, pending, reversal, and complaint deadlines.
- `outbox_events`: reliable downstream events written with the source mutation.

## Provider sequence

```text
ALLOWED
  -> transaction: create SUBMIT attempt + stable provider ref + SUBMITTED event/outbox
  -> external synthetic PSP call (outside transaction)
  -> transaction: complete attempt + apply legal outcome + state event/outbox
```

If the external call is unknown, the completion transaction records `PENDING` and a status-check
deadline. Recovery performs `STATUS_INQUIRY`; it does not create another `SUBMIT` attempt.
`SUBMITTED` also owns a durable status deadline, so a process crash before or after the external
call is recovered by inquiry and never by blind resubmission. API and worker processes share the
PostgreSQL-backed synthetic PSP state instead of process-local maps.
An interrupted `STARTED` status inquiry is safely resumed with the same stable request reference;
the synthetic PSP durably replays its first response instead of advancing twice.

## Recovery jobs

- `STATUS_CHECK`: inquire using the original provider reference.
- `PENDING_TIMEOUT`: move unresolved `PENDING` to `REVERSAL_PENDING` and start bounded clocks.
- `REVERSAL_CLOCK`: return wait, reversal escalation, or complaint-eligible outcome.
- reconciliation jobs reuse status inquiry and therefore preserve submit-once behavior.
- webhook jobs carry stable outbox/delivery keys for signed downstream delivery.

The worker scheduler scans durable recovery clocks and unpublished outbox rows. BullMQ job IDs are
deterministic, pending inquiries advance their next due time, reversal/complaint signals are written
back to the outbox, and successful signed deliveries mark `published_at` exactly once.

## API and callback security

Partner writes and provider callbacks are HMAC-SHA256 signed over method, actual path, timestamp,
nonce, and canonical JSON body digest. Partner nonces are single-use. Provider redelivery is
authenticated again and deduplicated by durable `event_id`, allowing safe retry acknowledgement.
No PIN, OTP, raw VPA, bank credential, or real-money connector is present. Cleartext resolved and
expected names are used transiently by deterministic risk evaluation; the ledger retains only the
derived merchant-name match flag and not the names or reusable name hashes.

## Migration and rollback

Migration `0001` backfills Phase 0A rows before setting new columns `NOT NULL`, creates tenant-aware
unique indexes before composite foreign keys, then adds provider/recovery tables. Apply with
`pnpm db:migrate` after PostgreSQL is healthy.

Application rollback is safe while the additive schema remains. Do not drop Package 0B columns or
tables until all Package 0B binaries and queued jobs are drained. A database rollback that removes
ledger history is intentionally not automated; restore from a tested backup instead.

## Verification

`pnpm verify` runs state/property tests, PostgreSQL-repository integration tests through an
in-process PostgreSQL-compatible engine, signed API flow tests, worker recovery tests, TypeScript,
lint, builds, migration consistency, and the repository security scan. CI additionally applies the
complete migration chain to PostgreSQL 17 before verification.
