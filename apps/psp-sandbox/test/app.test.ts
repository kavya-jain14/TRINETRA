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
});
