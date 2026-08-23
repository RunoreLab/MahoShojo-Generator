import 'server-only';

import {
  queryD1BatchPayload,
  queryD1Payload,
  queryD1RawPayload,
} from '@/lib/database/core';
import {
  createHttpD1Client,
  type D1HttpTransport,
} from '@mahoshojo/hosted-runtime/d1-http-client';

const hasD1Configuration = (): boolean => {
  if (typeof process === 'undefined') return false;
  return Boolean(
    process.env.D1_GATEWAY_URL
    || (
      process.env.CLOUDFLARE_ACCOUNT_ID
      && process.env.D1_DATABASE_ID
      && process.env.CLOUDFLARE_API_TOKEN
    ),
  );
};

const clientCache = new Map<string, unknown>();

const d1CacheKey = (): string => [
  process.env.D1_GATEWAY_URL ?? '',
  process.env.D1_DATABASE_ID ?? '',
  process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
  process.env.CLOUDFLARE_API_TOKEN ?? '',
  process.env.D1_GATEWAY_TOKEN ?? '',
].join(':');

export const createHttpD1ClientFromEnv = (): unknown | null => {
  if (!hasD1Configuration()) return null;

  const cacheKey = d1CacheKey();
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const transport: D1HttpTransport = {
    query: queryD1Payload,
    queryRaw: queryD1RawPayload,
    queryBatch: async (entries) => queryD1BatchPayload(entries.map((entry) => ({
      sql: entry.sqlText,
      params: entry.params,
    }))),
  };
  const client = createHttpD1Client(transport);
  clientCache.set(cacheKey, client);
  return client;
};
