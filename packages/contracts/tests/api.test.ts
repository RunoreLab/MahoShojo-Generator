import {
  API_CONTRACT_VERSION,
  ApiErrorCodeSchema,
  ApiResponseErrorSchema,
  ApiResponseSchema,
  ApiResponseSuccessSchema,
  ApiVersionSchema,
  isSupportedApiVersion,
  type ApiResponseError,
  type ApiResponseSuccess,
  type ApiErrorCode,
} from '@mahoshojo/contracts/api';
import {
  API_CONTRACT_VERSION as RootApiContractVersion,
  ApiErrorCodeSchema as RootApiErrorCodeSchema,
  ApiResponseErrorSchema as RootApiResponseErrorSchema,
  ApiResponseSchema as RootApiResponseSchema,
  ApiResponseSuccessSchema as RootApiResponseSuccessSchema,
  ApiVersionSchema as RootApiVersionSchema,
  isSupportedApiVersion as RootIsSupportedApiVersion,
  type ApiResponseError as RootApiResponseError,
  type ApiResponseSuccess as RootApiResponseSuccess,
} from '@mahoshojo/contracts';

describe('API wire contract v1', () => {
  it('supports only version 1 and exposes version schema/helper from root', () => {
    expect(API_CONTRACT_VERSION).toBe(1);
    expect(ApiVersionSchema.parse(1)).toBe(1);
    expect(RootApiVersionSchema).toBe(ApiVersionSchema);
    expect(isSupportedApiVersion(1)).toBe(true);
    expect(isSupportedApiVersion(0)).toBe(false);
    expect(isSupportedApiVersion(2)).toBe(false);
    expect(RootIsSupportedApiVersion(1)).toBe(true);
  });

  it('accepts v1 success envelope with JSON-only data', () => {
    expect(ApiResponseSuccessSchema.parse({
      apiVersion: 1,
      ok: true,
      requestId: 'request-1',
      data: { text: 'done', nested: { num: 1 }, list: [1, 'x', true, null] },
    })).toMatchObject({ ok: true });

    expect(() => ApiResponseSuccessSchema.parse({
      apiVersion: 1,
      ok: true,
      requestId: 'request-1',
      data: { bad: new Date() },
    })).toThrow();
  });

  it('accepts error envelope and enforces error safety fields', () => {
    expect(ApiResponseErrorSchema.parse({
      apiVersion: 1,
      ok: false,
      requestId: 'request-1',
      error: {
        code: 'timeout',
        message: 'timed out',
        retryable: true,
        retryAfterMs: 120,
      },
    })).toMatchObject({ ok: false });

    expect(() => ApiResponseErrorSchema.parse({
      apiVersion: 1,
      ok: false,
      error: { code: 'timeout', stack: 'server' },
    })).toThrow();

    expect(() => ApiResponseErrorSchema.parse({
      apiVersion: 1,
      ok: false,
      error: { code: 'timeout', cause: 'x' },
    })).toThrow();

    expect(() => ApiResponseErrorSchema.parse({
      apiVersion: 1,
      ok: false,
      error: { code: 'timeout', rawUpstream: 'abc' },
    })).toThrow();

    expect(() => ApiResponseErrorSchema.parse({
      apiVersion: 1,
      ok: false,
      error: { code: 'timeout', credential: 'x' },
    })).toThrow();

    expect(() => ApiResponseErrorSchema.parse({
      apiVersion: 1,
      ok: false,
      error: { code: 'timeout', nested: { credential: 'x' } as never },
    })).toThrow();
  });

  it('rejects invalid api contract versions and unsupported success/result shapes', () => {
    expect(ApiResponseSchema.safeParse({
      apiVersion: 2,
      ok: true,
      data: null,
    }).success).toBe(false);
    expect(ApiResponseSuccessSchema.safeParse({
      apiVersion: 1,
      ok: true,
      requestId: 'request-1',
      data: { bad: undefined },
    }).success).toBe(false);
    expect(ApiResponseErrorSchema.safeParse({
      apiVersion: 1,
      ok: false,
      error: { code: 'timeout', retryAfterMs: -1 },
    }).success).toBe(false);
  });

  it('exports API schemas from package root', () => {
    expect(RootApiContractVersion).toBe(API_CONTRACT_VERSION);
    expect(RootApiResponseSchema).toBe(ApiResponseSchema);
    expect(RootApiResponseErrorSchema).toBe(ApiResponseErrorSchema);
    expect(RootApiResponseSuccessSchema).toBe(ApiResponseSuccessSchema);
    expect(RootApiErrorCodeSchema).toBe(ApiErrorCodeSchema);
  });
});

describe('API error code stability', () => {
  it('keeps required stable values', () => {
    const requiredCodes: ApiErrorCode[] = ['invalid-request', 'not-found', 'internal-error', 'timeout'];
    for (const code of requiredCodes) {
      expect(ApiErrorCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(() => ApiErrorCodeSchema.parse('not-real')).toThrow();
  });

  it('supports exact stable set for transport errors', () => {
    expect(ApiErrorCodeSchema.options).toEqual([
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
  });
});

describe('API response inferred types', () => {
  it('exports inferred success/error response types from subpath and root entrypoint', () => {
    const typedSuccessPayload: ApiResponseSuccess = {
      apiVersion: 1,
      ok: true,
      data: { ok: true },
    };
    const typedErrorPayload: ApiResponseError = {
      apiVersion: 1,
      ok: false,
      error: { code: 'timeout' },
    };

    const rootTypedSuccessPayload: RootApiResponseSuccess = typedSuccessPayload;
    const rootTypedErrorPayload: RootApiResponseError = typedErrorPayload;

    expect(rootTypedSuccessPayload.ok).toBe(true);
    expect(rootTypedErrorPayload.ok).toBe(false);
  });
});
