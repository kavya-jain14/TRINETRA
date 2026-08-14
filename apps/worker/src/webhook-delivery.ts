export interface SignedWebhookDelivery {
  deliveryKey: string;
  body: string;
  signature: string;
}

export interface WebhookDeliveryClient {
  deliver(input: SignedWebhookDelivery): Promise<void>;
}

export interface WebhookHttpResponse {
  ok: boolean;
  status: number;
}

export type WebhookFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<WebhookHttpResponse>;

export class WebhookDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'WebhookDeliveryError';
  }
}

export class HttpWebhookDeliveryClient implements WebhookDeliveryClient {
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: WebhookFetch;

  constructor(endpoint: string, timeoutMs = 5_000, fetchImplementation?: WebhookFetch) {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new TypeError('Partner webhook URL must use HTTP or HTTPS.');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new RangeError('Webhook timeout must be between 100 and 30000 milliseconds.');
    }

    this.#endpoint = url.toString();
    this.#timeoutMs = timeoutMs;
    this.#fetch =
      fetchImplementation ?? (async (requestUrl, init) => await fetch(requestUrl, init));
  }

  async deliver(input: SignedWebhookDelivery): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);

    let response: WebhookHttpResponse;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': input.deliveryKey,
          'x-trinetra-delivery-key': input.deliveryKey,
          'x-trinetra-signature': input.signature,
        },
        body: input.body,
        signal: controller.signal,
      });
    } catch (error) {
      throw new WebhookDeliveryError('Partner webhook delivery failed.', true, { cause: error });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      throw new WebhookDeliveryError(
        `Partner webhook returned HTTP ${response.status}.`,
        retryable,
      );
    }
  }
}
