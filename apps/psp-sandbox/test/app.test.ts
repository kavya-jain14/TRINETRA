import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson, verifyPartnerSignature } from '@trinetra/security';

import { buildPspSandbox } from '../src/app.js';

describe('deterministic PSP sandbox', () => {
  it('returns a verifiable success event for the golden scenario', async () => {
    const callbackSecret = 'foundation-demo-secret-at-least-32-characters';
    const now = new Date('2026-08-10T12:00:00.000Z');
    const app = await buildPspSandbox({ callbackSecret, now: () => now });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/simulate',
      payload: {
        payment_id: 'pi_foundation_demo',
        amount_paise: 24_900,
        scenario: 'SUCCESS_IMMEDIATE',
      },
    });
    const payload = response.json();

    expect(response.statusCode).toBe(200);
    expect(payload.provider_event.status).toBe('SUCCEEDED');
    expect(
      verifyPartnerSignature(
        callbackSecret,
        {
          method: 'POST',
          path: payload.callback.path,
          timestamp: payload.callback.headers['x-timestamp'],
          nonce: payload.callback.headers['x-nonce'],
          body: canonicalJson(payload.provider_event),
        },
        payload.callback.headers['x-signature'],
      ),
    ).toBe(true);

    await app.close();
  });

  it('authenticates and deduplicates the synthetic partner webhook receiver', async () => {
    const callbackSecret = 'foundation-demo-secret-at-least-32-characters';
    const app = await buildPspSandbox({ callbackSecret });
    const envelope = {
      delivery_key: 'outbox-event-001',
      event_id: 'event-001',
      event_type: 'payment.state_changed',
      aggregate_id: 'pi_foundation_demo',
      payload: { payment_id: 'pi_foundation_demo', state: 'SUCCEEDED', resource_version: 5 },
      created_at: '2026-08-10T12:00:00.000Z',
    };
    const signature = createHmac('sha256', callbackSecret)
      .update(canonicalJson(envelope), 'utf8')
      .digest('hex');
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': envelope.delivery_key,
      'x-trinetra-delivery-key': envelope.delivery_key,
      'x-trinetra-signature': signature,
    };

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/partner-events',
      headers,
      payload: envelope,
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/partner-events',
      headers,
      payload: envelope,
    });
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/partner-events',
      headers: { ...headers, 'x-trinetra-signature': '0'.repeat(64) },
      payload: envelope,
    });

    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().outcome).toBe('ACCEPTED');
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().outcome).toBe('DUPLICATE');
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error.code).toBe('INVALID_SIGNATURE');
    await app.close();
  });
});
