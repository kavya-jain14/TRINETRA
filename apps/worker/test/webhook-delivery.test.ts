import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { workerEnvSchema } from '@trinetra/config';

import { HttpWebhookDeliveryClient, WebhookDeliveryError } from '../src/webhook-delivery.js';

const delivery = {
  deliveryKey: 'outbox-event-001',
  body: '{"delivery_key":"outbox-event-001"}',
  signature: 'a'.repeat(64),
};

describe('HTTP webhook delivery', () => {
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
