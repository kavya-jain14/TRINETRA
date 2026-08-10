import { z } from 'zod';

export const ApiErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'INVALID_SIGNATURE',
  'STALE_REQUEST',
  'REPLAY_DETECTED',
  'IDEMPOTENCY_CONFLICT',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'ILLEGAL_STATE_TRANSITION',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    trace_id: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
