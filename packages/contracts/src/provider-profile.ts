import { z } from 'zod';

import { JsonValueSchema } from './json-value';
import { IsoTimestampSchema, OpaqueKeySchema } from './primitives';

export const DIRECT_PROVIDER_PROFILE_VERSION = 1 as const;
export const DirectProviderProfileVersionSchema = z.literal(DIRECT_PROVIDER_PROFILE_VERSION);

export const DirectProviderAdapterSchema = z.enum([
  'openai-compatible',
  'anthropic',
  'google',
]);
export type DirectProviderAdapter = z.infer<typeof DirectProviderAdapterSchema>;

const nonBlankString = (maxLength: number) => z.string().trim().min(1).max(maxLength);

const DirectProviderBaseUrlSchema = z
  .string()
  .max(2048)
  .superRefine((value, context) => {
    if (value !== value.trim()) {
      context.addIssue({ code: 'custom', message: 'baseUrl must not have surrounding whitespace' });
      return;
    }

    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        context.addIssue({ code: 'custom', message: 'baseUrl must use HTTP or HTTPS' });
      }
      if (url.username !== '' || url.password !== '') {
        context.addIssue({ code: 'custom', message: 'baseUrl must not contain credentials' });
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'baseUrl must be an absolute URL' });
    }
  });

const HeaderNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, 'must be a valid HTTP header name');

const TRANSPORT_CONTROLLED_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
]);

const KNOWN_SECRET_HEADERS = new Set([
  'api-key',
  'authorization',
  'cf-access-client-secret',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-activity-token',
  'x-api-key',
  'x-goog-api-key',
]);

const addDisallowedHeaderIssues = (
  headers: Record<string, unknown>,
  context: z.RefinementCtx,
  disallowedHeaders: ReadonlySet<string>,
  message: string,
): void => {
  for (const headerName of Object.keys(headers)) {
    if (disallowedHeaders.has(headerName.toLowerCase())) {
      context.addIssue({
        code: 'custom',
        path: [headerName],
        message,
      });
    }
  }
};

const SecretHeaderRefsSchema = z
  .record(HeaderNameSchema, OpaqueKeySchema)
  .superRefine((headers, context) => {
    addDisallowedHeaderIssues(
      headers,
      context,
      TRANSPORT_CONTROLLED_HEADERS,
      'transport-controlled headers cannot be configured',
    );
  });

const PublicHeadersSchema = z
  .record(HeaderNameSchema, z.string().max(8192))
  .superRefine((headers, context) => {
    addDisallowedHeaderIssues(
      headers,
      context,
      TRANSPORT_CONTROLLED_HEADERS,
      'transport-controlled headers cannot be configured',
    );
    addDisallowedHeaderIssues(
      headers,
      context,
      KNOWN_SECRET_HEADERS,
      'secret-bearing headers must use secretHeaderRefs',
    );
  });

const GenerationDefaultsSchema = z.record(
  z.string().min(1).max(128),
  JsonValueSchema,
);

export const DirectProviderProfileV1Schema = z
  .object({
    version: DirectProviderProfileVersionSchema,
    id: OpaqueKeySchema,
    name: nonBlankString(120),
    adapter: DirectProviderAdapterSchema,
    baseUrl: DirectProviderBaseUrlSchema,
    modelId: nonBlankString(256),
    apiKeyRef: OpaqueKeySchema.optional(),
    secretHeaderRefs: SecretHeaderRefsSchema.optional(),
    publicHeaders: PublicHeadersSchema.optional(),
    generationDefaults: GenerationDefaultsSchema.optional(),
    transport: z
      .object({
        allowPublicHttp: z.boolean().optional(),
        maxRedirects: z.number().int().min(0).max(3).optional(),
      })
      .strict()
      .optional(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();
export type DirectProviderProfileV1 = z.infer<typeof DirectProviderProfileV1Schema>;
