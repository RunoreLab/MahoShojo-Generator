import { z } from './zod';

import { OpaqueKeySchema } from './primitives';
import { JsonValueSchema } from './json-value';

export const API_CONTRACT_VERSION = 1 as const;
export const ApiVersionSchema = z.literal(API_CONTRACT_VERSION);

export const SUPPORTED_API_VERSION_RANGE: Readonly<{ minInclusive: number; maxInclusive: number; }> = Object.freeze({
  minInclusive: API_CONTRACT_VERSION,
  maxInclusive: API_CONTRACT_VERSION,
});

export const ApiErrorCodeSchema = z.enum([
  'invalid-request',
  'validation-failed',
  'unauthorized',
  'forbidden',
  'not-found',
  'method-not-allowed',
  'conflict',
  'precondition-failed',
  'rate-limited',
  'payload-too-large',
  'unsupported-version',
  'service-unavailable',
  'timeout',
  'internal-error',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

const isNonBlankText = z
  .string()
  .superRefine((value, context) => {
    if (value.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'must not be empty or blank',
      });
    }
  });

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: isNonBlankText.optional(),
  retryable: z.boolean().optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
}).strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiResponseSuccessSchema = z.object({
  apiVersion: ApiVersionSchema,
  ok: z.literal(true),
  requestId: OpaqueKeySchema.optional(),
  data: JsonValueSchema,
}).strict();
export type ApiResponseSuccess = z.infer<typeof ApiResponseSuccessSchema>;

export const ApiResponseErrorSchema = z.object({
  apiVersion: ApiVersionSchema,
  ok: z.literal(false),
  requestId: OpaqueKeySchema.optional(),
  error: ApiErrorSchema,
}).strict();
export type ApiResponseError = z.infer<typeof ApiResponseErrorSchema>;

export const ApiResponseSchema = z.discriminatedUnion('ok', [
  ApiResponseSuccessSchema,
  ApiResponseErrorSchema,
]);
export type ApiResponse = z.infer<typeof ApiResponseSchema>;

export const isSupportedApiVersion = (version: number): boolean =>
  Number.isInteger(version) &&
  version >= SUPPORTED_API_VERSION_RANGE.minInclusive &&
  version <= SUPPORTED_API_VERSION_RANGE.maxInclusive;
