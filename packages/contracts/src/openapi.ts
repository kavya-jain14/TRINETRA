import { z } from 'zod';

import { FraudCaseListSchema, FraudCaseSnapshotSchema } from './case.js';
import { DemoPaymentListSchema, DemoPaymentSnapshotSchema, DemoRunRequestSchema } from './demo.js';
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
    '/v1/demo/scenarios/trusted-payment/run': {
      post: {
        summary: 'Run the fixed trusted-payment scenario in non-production demo mode',
        'x-demo-only': true,
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/DemoRunRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'Durable payment decision, provider result, and immutable timeline',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DemoPaymentSnapshot' } },
            },
          },
        },
      },
    },
    '/v1/demo/scenarios/refund-collect/run': {
      post: {
        summary: 'Run the fixed deceptive refund collect scenario in non-production demo mode',
        'x-demo-only': true,
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/DemoRunRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'Blocked payment and evidence-backed fraud case',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DemoPaymentSnapshot' } },
            },
          },
        },
      },
    },
    '/v1/demo/scenarios/timeout-recovery/run': {
      post: {
        summary: 'Run one accepted-but-timed-out payment in non-production demo mode',
        'x-demo-only': true,
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/DemoRunRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'Original payment preserved as pending with one unknown submission',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DemoPaymentSnapshot' } },
            },
          },
        },
      },
    },
    '/v1/demo/scenarios/timeout-recovery/recover': {
      post: {
        summary: 'Run one deterministic status-first recovery inquiry in demo mode',
        'x-demo-only': true,
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/DemoRunRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Payment resolved without a second provider submission',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DemoPaymentSnapshot' } },
            },
          },
        },
      },
    },
    '/v1/demo/payments': {
      get: {
        summary: 'List recent fixed-scenario demo payments for the operations console',
        'x-demo-only': true,
        responses: {
          '200': {
            description: 'Recent synthetic demo payments',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DemoPaymentList' } },
            },
          },
        },
      },
    },
    '/v1/demo/payments/{paymentId}': {
      get: {
        summary: 'Read one durable fixed-scenario demo timeline',
        'x-demo-only': true,
        parameters: [{ in: 'path', name: 'paymentId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Synthetic demo payment timeline',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DemoPaymentSnapshot' } },
            },
          },
        },
      },
    },
    '/v1/demo/cases': {
      get: {
        summary: 'List durable synthetic fraud cases for the operations console',
        'x-demo-only': true,
        responses: {
          '200': {
            description: 'Recent evidence-backed synthetic cases',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/FraudCaseList' } },
            },
          },
        },
      },
    },
    '/v1/demo/cases/{caseId}': {
      get: {
        summary: 'Read one durable synthetic fraud case and its immutable timeline',
        'x-demo-only': true,
        parameters: [{ in: 'path', name: 'caseId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Synthetic fraud case detail',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/FraudCaseSnapshot' } },
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
      DemoRunRequest: z.toJSONSchema(DemoRunRequestSchema),
      DemoPaymentSnapshot: z.toJSONSchema(DemoPaymentSnapshotSchema),
      DemoPaymentList: z.toJSONSchema(DemoPaymentListSchema),
      FraudCaseSnapshot: z.toJSONSchema(FraudCaseSnapshotSchema),
      FraudCaseList: z.toJSONSchema(FraudCaseListSchema),
      ApiError: z.toJSONSchema(ApiErrorSchema),
    },
  },
} as const;
