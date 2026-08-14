import { createHash } from 'node:crypto';

export interface NonceStore {
  consume(scope: string, nonce: string, ttlMs: number): Promise<boolean>;
}

export interface InMemoryNonceStoreOptions {
  now?: () => number;
  maxEntries?: number;
}

export class InMemoryNonceStore implements NonceStore {
  readonly #expiries = new Map<string, number>();
  readonly #now: () => number;
  readonly #maxEntries: number;

  constructor(options: InMemoryNonceStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#maxEntries = options.maxEntries ?? 10_000;

    if (!Number.isSafeInteger(this.#maxEntries) || this.#maxEntries < 1) {
      throw new RangeError('maxEntries must be a positive safe integer');
    }
  }

  async consume(scope: string, nonce: string, ttlMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) return false;

    const now = this.#now();
    for (const [storedKey, expiresAt] of this.#expiries) {
      if (expiresAt <= now) this.#expiries.delete(storedKey);
    }

    const key = `${scope}:${nonce}`;
    const expiresAt = this.#expiries.get(key);

    if (expiresAt !== undefined && expiresAt > now) {
      return false;
    }

    if (this.#expiries.size >= this.#maxEntries) return false;

    this.#expiries.set(key, now + ttlMs);
    return true;
  }
}

export interface RedisNonceClient {
  set(
    key: string,
    value: string,
    expiryMode: 'PX',
    ttlMs: number,
    setMode: 'NX',
  ): Promise<'OK' | null>;
}

export class RedisNonceStore implements NonceStore {
  readonly #client: RedisNonceClient;
  readonly #keyPrefix: string;

  constructor(client: RedisNonceClient, keyPrefix = 'trinetra:partner-nonce:') {
    this.#client = client;
    this.#keyPrefix = keyPrefix;
  }

  async consume(scope: string, nonce: string, ttlMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) return false;

    const digest = createHash('sha256').update(scope).update('\0').update(nonce).digest('hex');
    const result = await this.#client.set(`${this.#keyPrefix}${digest}`, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }
}
