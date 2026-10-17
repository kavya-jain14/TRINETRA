import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { workerEnvSchema } from '@trinetra/config';

import { HttpWebhookDeliveryClient, WebhookDeliveryError } from '../src/webhook-delivery.js';

const delivery = {
  deliveryKey: 'outbox-event-001',
  body: '{"delivery_key":"outbox-event-001"}',
  signature: 'a'.repeat(64),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP webhook delivery', () => {
  it.each([
    { status: 202, retryable: null },
    { status: 400, retryable: false },
    { status: 503, retryable: true },
  ])('preserves HTTP $status when response cleanup fails', async ({ status, retryable }) => {
    const cancel = vi.fn().mockRejectedValue(new Error('Synthetic response cleanup failure'));
    const response = new Response(new ReadableStream({ cancel }), { status });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const client = new HttpWebhookDeliveryClient('https://partner.example.test/v1/events');

    if (retryable === null) {
      await expect(client.deliver(delivery)).resolves.toBeUndefined();
    } else {
      await expect(client.deliver(delivery)).rejects.toMatchObject({
        message: `Partner webhook returned HTTP ${status}.`,
        retryable,
      });
    }
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not forward a signed delivery through a redirect', async () => {
    let redirectedRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(307, { location: '/untrusted' }).end();
      } else {
        redirectedRequests += 1;
        response.writeHead(202).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const client = new HttpWebhookDeliveryClient(`http://127.0.0.1:${port}/redirect`);
      await expect(client.deliver(delivery)).rejects.toBeInstanceOf(WebhookDeliveryError);
      expect(redirectedRequests).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it('posts the signed envelope with a stable idempotency key', async () => {
    let receivedBody = '';
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      receivedHeaders = request.headers;
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        receivedBody += chunk;
      });
      request.on('end', () => {
        response.writeHead(202).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const { port } = server.address() as AddressInfo;
      const client = new HttpWebhookDeliveryClient(`http://127.0.0.1:${port}/v1/events`, 5_000);
      await client.deliver(delivery);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }

    expect(receivedBody).toBe(delivery.body);
    expect(receivedHeaders).toMatchObject({
      'idempotency-key': delivery.deliveryKey,
      'x-trinetra-delivery-key': delivery.deliveryKey,
      'x-trinetra-signature': delivery.signature,
    });
  });

  it('classifies server failures as retryable and contract failures as permanent', async () => {
    const retryableClient = new HttpWebhookDeliveryClient(
      'https://partner.example.test/v1/events',
      5_000,
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );
    const permanentClient = new HttpWebhookDeliveryClient(
      'https://partner.example.test/v1/events',
      5_000,
      vi.fn().mockResolvedValue({ ok: false, status: 400 }),
    );

    await expect(retryableClient.deliver(delivery)).rejects.toMatchObject({
      retryable: true,
    });
    await expect(permanentClient.deliver(delivery)).rejects.toMatchObject({
      retryable: false,
    });
    await expect(permanentClient.deliver(delivery)).rejects.toBeInstanceOf(WebhookDeliveryError);
  });

  it('requires HTTPS for a production partner endpoint', () => {
    const parsed = workerEnvSchema.safeParse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://trinetra:secret@localhost:5432/trinetra',
      REDIS_URL: 'redis://localhost:6379',
      PARTNER_WEBHOOK_URL: 'http://partner.example.test/v1/events',
      DEMO_PARTNER_SECRET: 'worker-test-secret-at-least-32-characters',
    });

    expect(parsed.success).toBe(false);
  });
});
