import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryNonceStore,
  RedisNonceStore,
  signPartnerRequest,
  verifyPartnerSignature,
} from '../src/index.js';

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

  it('prunes expired in-memory entries and fails closed at its configured bound', async () => {
    let now = 1_000;
    const store = new InMemoryNonceStore({ now: () => now, maxEntries: 2 });

    await expect(store.consume('partner_demo', 'nonce_001', 100)).resolves.toBe(true);
    await expect(store.consume('partner_demo', 'nonce_002', 1_000)).resolves.toBe(true);
    await expect(store.consume('partner_demo', 'nonce_003', 1_000)).resolves.toBe(false);

    now = 1_101;
    await expect(store.consume('partner_demo', 'nonce_003', 1_000)).resolves.toBe(true);
  });

  it('uses an atomic, TTL-bound Redis insert without exposing the nonce in the key', async () => {
    const set = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const store = new RedisNonceStore({ set });

    await expect(store.consume('partner_demo', 'nonce_secret_001', 300_000)).resolves.toBe(true);
    await expect(store.consume('partner_demo', 'nonce_secret_001', 300_000)).resolves.toBe(false);

    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls[0]?.[0]).not.toContain('partner_demo');
    expect(set.mock.calls[0]?.[0]).not.toContain('nonce_secret_001');
    expect(set.mock.calls[0]?.slice(1)).toEqual(['1', 'PX', 300_000, 'NX']);
  });
});
