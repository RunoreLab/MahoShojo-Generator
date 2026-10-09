import { z } from './zod';

import { SafeJsonValueSchema } from './json-value';
import { IsoTimestampSchema, OpaqueKeySchema } from './primitives';
import { SecretRefSchema } from './secret-ref';
import { jsonUtf8ByteLength } from './wire-size';

export const DIRECT_PROVIDER_PROFILE_VERSION = 1 as const;
export const DirectProviderProfileVersionSchema = z.literal(DIRECT_PROVIDER_PROFILE_VERSION);
export const MAX_DIRECT_PROVIDER_PROFILE_BYTES = 64 * 1024;
export const MAX_DIRECT_PROVIDER_PROFILE_HEADERS = 32;
export const MAX_DIRECT_PROVIDER_GENERATION_DEFAULTS = 64;

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

const HeaderValueSchema = z
  .string()
  .max(8192)
  .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value), 'must not contain HTTP control characters');

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

const addCanonicalDuplicateHeaderIssues = (
  headers: Record<string, unknown>,
  context: z.RefinementCtx,
): void => {
  const originalNamesByCanonicalName = new Map<string, string>();

  for (const headerName of Object.keys(headers)) {
    const canonicalName = headerName.toLowerCase();
    if (originalNamesByCanonicalName.has(canonicalName)) {
      context.addIssue({
        code: 'custom',
        path: [headerName],
        message: 'HTTP header names are case-insensitive and must be unique',
      });
      continue;
    }

    originalNamesByCanonicalName.set(canonicalName, headerName);
  }
};

const SecretRefValueSchema = SecretRefSchema.refine(
  (value) => !/^(?:preset|account-session):/iu.test(value),
  'reserved credentials cannot be referenced by a custom profile',
);

const SecretHeaderRefsSchema = z
  .record(HeaderNameSchema, SecretRefValueSchema)
  .superRefine((headers, context) => {
    if (Object.keys(headers).length > MAX_DIRECT_PROVIDER_PROFILE_HEADERS) {
      context.addIssue({ code: 'custom', message: `must contain at most ${MAX_DIRECT_PROVIDER_PROFILE_HEADERS} headers` });
    }
    addDisallowedHeaderIssues(
      headers,
      context,
      TRANSPORT_CONTROLLED_HEADERS,
      'transport-controlled headers cannot be configured',
    );
    addCanonicalDuplicateHeaderIssues(headers, context);
  });

const PublicHeadersSchema = z
  .record(HeaderNameSchema, HeaderValueSchema)
  .superRefine((headers, context) => {
    if (Object.keys(headers).length > MAX_DIRECT_PROVIDER_PROFILE_HEADERS) {
      context.addIssue({ code: 'custom', message: `must contain at most ${MAX_DIRECT_PROVIDER_PROFILE_HEADERS} headers` });
    }
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
    addCanonicalDuplicateHeaderIssues(headers, context);
  });

const GenerationDefaultKeySchema = z
  .string()
  .min(1)
  .max(128)
  .refine((key) => !['__proto__', 'prototype', 'constructor'].includes(key), 'unsafe key is not allowed');

const GenerationDefaultsSchema = z
  .record(GenerationDefaultKeySchema, SafeJsonValueSchema)
  .superRefine((defaults, context) => {
    if (Object.keys(defaults).length > MAX_DIRECT_PROVIDER_GENERATION_DEFAULTS) {
      context.addIssue({ code: 'custom', message: `must contain at most ${MAX_DIRECT_PROVIDER_GENERATION_DEFAULTS} defaults` });
    }
  });

const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1', '[::1]']);

export const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(normalized)) return true;
  return /^127(?:\.\d{1,3}){3}$/u.test(normalized);
};

/**
 * 明文 HTTP 的判定。
 *
 * loopback（`localhost` / `127.0.0.0/8` / `::1`）默认允许，因为它对应用户自己机器上的
 * Ollama、LM Studio、llama.cpp server 等本地推理服务；其余主机的明文 HTTP 必须由
 * `transport.allowPublicHttp` 显式记录用户确认。
 */
export const requiresExplicitPublicHttpConfirmation = (baseUrl: string): boolean => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    // 非法 URL 由 DirectProviderBaseUrlSchema 单独报错，这里不做重复判断。
    return false;
  }
  if (url.protocol !== 'http:') return false;
  return !isLoopbackHost(url.hostname);
};

/**
 * Profile 级别的跨字段规则。
 *
 * 单独抽成函数而不是只写在 `superRefine` 里，是因为 Zod 4 的 `.pick()` **不会**携带对象级
 * 检查：完整 Profile 与 Rust 侧的窄投影都必须显式挂上同一份规则，否则投影会静默放宽。
 */
const addProfileWideIssues = (
  profile: {
    baseUrl: string;
    secretHeaderRefs?: Record<string, unknown>;
    publicHeaders?: Record<string, unknown>;
    transport?: { allowPublicHttp?: boolean } | undefined;
  },
  context: z.RefinementCtx,
): void => {
  const publicHeaderNames = new Set(
    Object.keys(profile.publicHeaders ?? {}).map((headerName) => headerName.toLowerCase()),
  );
  for (const secretHeaderName of Object.keys(profile.secretHeaderRefs ?? {})) {
    if (publicHeaderNames.has(secretHeaderName.toLowerCase())) {
      context.addIssue({
        code: 'custom',
        path: ['secretHeaderRefs', secretHeaderName],
        message: 'HTTP header names are case-insensitive and cannot overlap publicHeaders',
      });
    }
  }

  if (
    requiresExplicitPublicHttpConfirmation(profile.baseUrl)
    && profile.transport?.allowPublicHttp !== true
  ) {
    context.addIssue({
      code: 'custom',
      path: ['transport', 'allowPublicHttp'],
      message:
        'cleartext HTTP to a non-loopback host requires explicit user confirmation via transport.allowPublicHttp',
    });
  }
};

export const DirectProviderProfileObjectSchema = z
  .object({
    version: DirectProviderProfileVersionSchema,
    id: OpaqueKeySchema,
    name: nonBlankString(120),
    adapter: DirectProviderAdapterSchema,
    baseUrl: DirectProviderBaseUrlSchema,
    modelId: nonBlankString(256),
    apiKeyRef: SecretRefValueSchema.optional(),
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

export const DirectProviderProfileV1Schema = DirectProviderProfileObjectSchema.superRefine(
  (profile, context) => {
    addProfileWideIssues(profile, context);

    if (jsonUtf8ByteLength(profile) > MAX_DIRECT_PROVIDER_PROFILE_BYTES) {
      context.addIssue({
        code: 'too_big',
        maximum: MAX_DIRECT_PROVIDER_PROFILE_BYTES,
        origin: 'value',
        inclusive: true,
        message: `provider profile must not exceed ${MAX_DIRECT_PROVIDER_PROFILE_BYTES} UTF-8 bytes`,
      });
    }
  },
);
export type DirectProviderProfileV1 = z.infer<typeof DirectProviderProfileV1Schema>;

/**
 * Rust 侧执行 Direct AI 时真正需要的字段子集。
 *
 * 完整 Profile 的权威校验始终是 `DirectProviderProfileV1Schema`；本投影只承载"Rust 必须
 * 自己解析出来的部分"，因为出站 endpoint 只能来自已保存 Profile，而 renderer 不得参与
 * 出站请求的构造。
 *
 * 两条必须知道的性质：
 *
 * - 投影是 `strict` 的，只接受下列字段。这让 renderer 无法借同一通道把
 *   `generationDefaults` 之类 Rust 不解析的字段塞进执行路径。
 * - Zod 4 的 `.pick()` 不携带对象级检查，因此 `addProfileWideIssues` 在这里**显式**重复
 *   挂载。跨语言 fixture 会同时覆盖完整 Profile 与本投影，任何一侧漏挂规则都会失败。
 */
export const DirectProviderExecutionProfileSchema = DirectProviderProfileObjectSchema.pick({
  id: true,
  name: true,
  adapter: true,
  baseUrl: true,
  modelId: true,
  apiKeyRef: true,
  secretHeaderRefs: true,
  publicHeaders: true,
  transport: true,
}).superRefine(addProfileWideIssues);
export type DirectProviderExecutionProfile = z.infer<typeof DirectProviderExecutionProfileSchema>;

export const toDirectProviderExecutionProfile = (
  profile: DirectProviderProfileV1,
): DirectProviderExecutionProfile => ({
  id: profile.id,
  name: profile.name,
  adapter: profile.adapter,
  baseUrl: profile.baseUrl,
  modelId: profile.modelId,
  ...(profile.apiKeyRef === undefined ? {} : { apiKeyRef: profile.apiKeyRef }),
  ...(profile.secretHeaderRefs === undefined ? {} : { secretHeaderRefs: profile.secretHeaderRefs }),
  ...(profile.publicHeaders === undefined ? {} : { publicHeaders: profile.publicHeaders }),
  ...(profile.transport === undefined ? {} : { transport: profile.transport }),
});
