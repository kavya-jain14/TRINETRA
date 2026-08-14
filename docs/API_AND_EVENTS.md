# API and events

Base path: `/v1`. JSON schemas originate in `@trinetra/contracts`; `/openapi.json` publishes the foundation document.

## Signed writes

Every partner write includes:

- `Idempotency-Key`
- `X-Partner-Key`
- `X-Timestamp` as Unix seconds
- `X-Nonce`
- `X-Signature` as lowercase hex HMAC-SHA256

The canonical request is:

```text
UPPERCASE_METHOD + "\n" +
CANONICAL_PATH + "\n" +
TIMESTAMP + "\n" +
NONCE + "\n" +
SHA256_HEX(CANONICAL_JSON_BODY)
```

Canonical JSON recursively sorts object keys, preserves array order, removes properties whose value is `undefined`, rejects non-finite numbers, and emits compact UTF-8 JSON. The reference implementation is `canonicalJson` in `@trinetra/security`.

The server permits five minutes of clock skew. A valid partner nonce is consumed once. Reusing a
tenant-scoped payment-intent idempotency key with the same canonical body returns the original
logical result; changing the body returns `IDEMPOTENCY_CONFLICT`.

Provider callbacks use the same canonical HMAC construction without partner or idempotency
headers. Callback `event_id` is the durable deduplication key so an authenticated redelivery can
receive a successful `DUPLICATE` acknowledgement.

## Payment endpoints

- `POST /v1/payment-intents` evaluates the three risk lenses and atomically creates the intent,
  initial state event, outbox event, and replay record in PostgreSQL.
- `POST /v1/payment-intents/{paymentId}/submit` accepts only an eligible payment, persists one
  stable provider request reference, and never performs a second provider submission.
- `POST /v1/provider-events/trinetra-sandbox` verifies the provider signature, deduplicates the
  provider event, and applies only a legal monotonic transition.

Health endpoints are separate:

- `GET /health/live`
- `GET /health/ready`

`/health/live` only proves the process can answer. `/health/ready` actively checks required PostgreSQL and Redis connections and returns HTTP `503` with dependency status when either is unavailable.

- `GET /openapi.json`

## Stable error shape

```json
{
  "error": {
    "code": "IDEMPOTENCY_CONFLICT",
    "message": "The idempotency key is already bound to a different request body.",
    "trace_id": "tr_..."
  }
}
```

Unknown errors never include a stack trace or raw provider message.

## Event discipline

Domain event names are published in `DomainEventTypeSchema`. A durable mutation, append-only state
event, and outbox record commit in the same PostgreSQL transaction. Event consumers are
at-least-once and therefore idempotent. Provider calls occur only after the submission transaction
commits; unknown outcomes become `PENDING` and schedule status-first recovery.

Partner outbox delivery uses the strict `PartnerWebhookEnvelope` contract. The worker sends
canonical JSON with `Idempotency-Key`, `X-TRINETRA-Delivery-Key`, and an HMAC-SHA256
`X-TRINETRA-Signature`. Receivers deduplicate the stable delivery key and return `2xx` only after
accepting or recognizing the event. Development uses the synthetic `POST /v1/partner-events`
receiver; production configuration requires an HTTPS endpoint.
