import type { FastifyReply, FastifyRequest } from 'fastify';

import { type ApiErrorCode } from '@trinetra/contracts';
import {
  canonicalJson,
  type NonceStore,
  sha256Hex,
  verifyPartnerSignature,
} from '@trinetra/security';

export interface PartnerAuthConfig {
  partnerKey: string;
  partnerSecret: string;
  nonceStore: NonceStore;
  now: () => Date;
  clockSkewSeconds: number;
}

export interface AuthenticatedPartnerRequest {
  idempotencyKey: string;
  partnerKey: string;
  requestHash: string;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendAuthError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ApiErrorCode,
  message: string,
): void {
  void reply.code(401).send({
    error: { code, message, trace_id: `tr_${request.id}` },
  });
}

export async function authenticatePartnerRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  config: PartnerAuthConfig,
): Promise<AuthenticatedPartnerRequest | undefined> {
  const partnerKey = header(request, 'x-partner-key');
  const timestamp = header(request, 'x-timestamp');
  const nonce = header(request, 'x-nonce');
  const signature = header(request, 'x-signature');
  const idempotencyKey = header(request, 'idempotency-key');

  if (!partnerKey || !timestamp || !nonce || !signature || !idempotencyKey) {
    sendAuthError(request, reply, 'AUTH_REQUIRED', 'Signed partner headers are required.');
    return undefined;
  }

  if (partnerKey !== config.partnerKey) {
    sendAuthError(request, reply, 'INVALID_SIGNATURE', 'Partner authentication failed.');
    return undefined;
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(config.now().getTime() / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > config.clockSkewSeconds
  ) {
    sendAuthError(
      request,
      reply,
      'STALE_REQUEST',
      'Request timestamp is outside the allowed window.',
    );
    return undefined;
  }

  const body = canonicalJson(request.body ?? {});
  const signatureValid = verifyPartnerSignature(
    config.partnerSecret,
    {
      method: request.method,
      path: request.routeOptions.url ?? request.url,
      timestamp,
      nonce,
      body,
    },
    signature,
  );
  if (!signatureValid) {
    sendAuthError(request, reply, 'INVALID_SIGNATURE', 'Partner authentication failed.');
    return undefined;
  }

  if (!(await config.nonceStore.consume(partnerKey, nonce, config.clockSkewSeconds * 1000))) {
    sendAuthError(request, reply, 'REPLAY_DETECTED', 'This nonce has already been consumed.');
    return undefined;
  }

  return { idempotencyKey, partnerKey, requestHash: sha256Hex(body) };
}
