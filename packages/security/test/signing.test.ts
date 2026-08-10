import { describe, expect, it } from 'vitest';

import { InMemoryNonceStore, signPartnerRequest, verifyPartnerSignature } from '../src/index.js';

const request = {
  method: 'POST',
  path: '/v1/payment-intents',
  timestamp: '1786343400',
  nonce: 'nonce_demo_001',
  body: '{"amount_paise":24900}',
};

describe('partner request signing', () => {
  it('accepts the exact canonical request and rejects body tampering', () => {
    const signature = signPartnerRequest('a-demo-secret-with-at-least-32-characters', request);

    expect(
      verifyPartnerSignature('a-demo-secret-with-at-least-32-characters', request, signature),
    ).toBe(true);
    expect(
      verifyPartnerSignature(
        'a-demo-secret-with-at-least-32-characters',
        { ...request, body: '{"amount_paise":24901}' },
        signature,
      ),
    ).toBe(false);
  });

  it('consumes a nonce once per partner scope', async () => {
    const store = new InMemoryNonceStore();

    await expect(store.consume('partner_demo', 'nonce_demo_001', 300_000)).resolves.toBe(true);
    await expect(store.consume('partner_demo', 'nonce_demo_001', 300_000)).resolves.toBe(false);
    await expect(store.consume('partner_other', 'nonce_demo_001', 300_000)).resolves.toBe(true);
  });
});
