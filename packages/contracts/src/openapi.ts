import { z } from 'zod';

import { ApiErrorSchema } from './errors.js';
import { PaymentIntentRequestSchema, RiskAssessmentSchema } from './payment-intent.js';
import {
  PaymentOperationResultSchema,
  PaymentSubmissionRequestSchema,
  ProviderCallbackAckSchema,
  ProviderCallbackSchema,
} from './payment-ledger.js';

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'TRINETRA Partner API',
    version: '0.1.0',
    description: 'Synthetic-only UPI risk and payment-resilience gateway contract.',
  },
  servers: [{ url: 'http://localhost:4000' }],
  paths: {
    '/v1/payment-intents': {
      post: {
        summary: 'Create and evaluate a payment intent',
        security: [{ partnerSignature: [] }],
        parameters: [
          { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'X-Partner-Key', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'X-Timestamp', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'X-Nonce', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'X-Signature', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PaymentIntentRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'Explainable risk decision',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/RiskAssessment' } },
            },
          },
          '4XX': {
            description: 'Stable API error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
          },
        },
      },
    },
    '/v1/payment-intents/{paymentId}/submit': {
      post: {
        summary: 'Submit an allowed synthetic payment exactly once',
        security: [{ partnerSignature: [] }],
        parameters: [
          { in: 'path', name: 'paymentId', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'X-Partner-Key', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'X-Timestamp', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'X-Nonce', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'X-Signature', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PaymentSubmissionRequest' },
            },
          },
        },
        responses: {
          '202': {
            description: 'Provider submission accepted or resolved',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaymentOperationResult' },
              },
            },
          },
        },
      },
    },
    '/v1/provider-events/trinetra-sandbox': {
      post: {
        summary: 'Receive an authenticated idempotent synthetic provider callback',
        security: [{ providerSignature: [] }],
        parameters: [
          { in: 'header', name: 'X-Timestamp', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'X-Nonce', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'X-Signature', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ProviderCallback' } },
          },
        },
        responses: {
          '202': {
            description: 'Callback accepted, deduplicated, or safely ignored as stale',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ProviderCallbackAck' } },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      partnerSignature: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Signature',
        description: 'HMAC-SHA256 over the documented canonical request.',
      },
      providerSignature: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Signature',
        description: 'Synthetic PSP HMAC-SHA256 callback signature.',
      },
    },
    schemas: {
      PaymentIntentRequest: z.toJSONSchema(PaymentIntentRequestSchema),
      RiskAssessment: z.toJSONSchema(RiskAssessmentSchema),
      PaymentSubmissionRequest: z.toJSONSchema(PaymentSubmissionRequestSchema),
      PaymentOperationResult: z.toJSONSchema(PaymentOperationResultSchema),
      ProviderCallback: z.toJSONSchema(ProviderCallbackSchema),
      ProviderCallbackAck: z.toJSONSchema(ProviderCallbackAckSchema),
      ApiError: z.toJSONSchema(ApiErrorSchema),
    },
  },
} as const;
