export interface NonceStore {
  consume(scope: string, nonce: string, ttlMs: number): Promise<boolean>;
}

export class InMemoryNonceStore implements NonceStore {
  readonly #expiries = new Map<string, number>();

  async consume(scope: string, nonce: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const key = `${scope}:${nonce}`;
    const expiresAt = this.#expiries.get(key);

    if (expiresAt !== undefined && expiresAt > now) {
      return false;
    }

    this.#expiries.set(key, now + ttlMs);
    return true;
  }
}
