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

The server permits five minutes of clock skew. A valid nonce is consumed once per partner. Reusing an idempotency key with the same canonical body returns the original logical result; changing the body returns `IDEMPOTENCY_CONFLICT`.

## Foundation endpoint

`POST /v1/payment-intents` validates the published request, evaluates all three risk lenses, and returns the explainable risk contract. The current process-memory persistence is explicit and will be replaced by the Package 0B repository transaction.

Health endpoints are separate:

- `GET /health/live`
- `GET /health/ready`
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

Domain event names are published in `DomainEventTypeSchema`. A durable mutation and its outbox record must commit in the same PostgreSQL transaction. Event consumers are at-least-once and therefore idempotent.
