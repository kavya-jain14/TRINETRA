import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface CanonicalRequestInput {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('Canonical JSON cannot encode non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError(`Canonical JSON cannot encode ${typeof value}`);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonicalRequest(input: CanonicalRequestInput): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    sha256Hex(input.body),
  ].join('\n');
}

export function signPartnerRequest(secret: string, input: CanonicalRequestInput): string {
  return createHmac('sha256', secret).update(canonicalRequest(input), 'utf8').digest('hex');
}

export function verifyPartnerSignature(
  secret: string,
  input: CanonicalRequestInput,
  candidate: string,
): boolean {
  if (!/^[a-f0-9]{64}$/i.test(candidate)) {
    return false;
  }

  const expected = Buffer.from(signPartnerRequest(secret, input), 'hex');
  const received = Buffer.from(candidate, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
