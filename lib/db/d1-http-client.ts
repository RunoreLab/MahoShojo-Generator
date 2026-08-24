import 'server-only';

import {
  type D1HttpClient,
  createHttpD1Client,
  createD1HttpTransport,
} from '@mahoshojo/hosted-runtime/d1-http-client';

const envValue = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const hasD1Configuration = (): boolean => {
  if (typeof process === 'undefined') return false;
  return Boolean(
    envValue('D1_GATEWAY_URL')
    || (
      envValue('CLOUDFLARE_ACCOUNT_ID')
      && envValue('D1_DATABASE_ID')
      && envValue('CLOUDFLARE_API_TOKEN')
    ),
  );
};

let clientCache: {
  cacheKey: string;
  credentialFingerprint: string;
  fetcher: typeof globalThis.fetch;
  client: D1HttpClient;
} | undefined;

const d1CacheKey = (): string => JSON.stringify([
  envValue('D1_GATEWAY_URL') ?? '',
  envValue('D1_DATABASE_ID') ?? '',
  envValue('CLOUDFLARE_ACCOUNT_ID') ?? '',
]);

const d1CredentialFingerprint = (): string => JSON.stringify([
  envValue('CLOUDFLARE_API_TOKEN') ?? '',
  envValue('D1_GATEWAY_TOKEN') ?? '',
  envValue('D1_GATEWAY_HMAC_SECRET') ?? '',
  envValue('CF_ACCESS_CLIENT_ID') ?? '',
  envValue('CF_ACCESS_CLIENT_SECRET') ?? '',
]);

export const createHttpD1ClientFromEnv = (): D1HttpClient | null => {
  if (!hasD1Configuration()) return null;

  const cacheKey = d1CacheKey();
  const credentialFingerprint = d1CredentialFingerprint();
  const fetcher = globalThis.fetch;
  const cached = clientCache;
  if (
    cached?.cacheKey === cacheKey
    && cached.fetcher === fetcher
    && cached.credentialFingerprint === credentialFingerprint
  ) {
    return cached.client;
  }

  const gatewayUrl = envValue('D1_GATEWAY_URL');
  const transport = createD1HttpTransport(gatewayUrl ? {
    kind: 'gateway',
    baseUrl: gatewayUrl,
    token: envValue('D1_GATEWAY_TOKEN'),
    hmacSecret: envValue('D1_GATEWAY_HMAC_SECRET'),
    accessClientId: envValue('CF_ACCESS_CLIENT_ID'),
    accessClientSecret: envValue('CF_ACCESS_CLIENT_SECRET'),
  } : {
    kind: 'cloudflare-api',
    queryUrl: `https://api.cloudflare.com/client/v4/accounts/${envValue('CLOUDFLARE_ACCOUNT_ID')}/d1/database/${envValue('D1_DATABASE_ID')}/query`,
    rawUrl: `https://api.cloudflare.com/client/v4/accounts/${envValue('CLOUDFLARE_ACCOUNT_ID')}/d1/database/${envValue('D1_DATABASE_ID')}/raw`,
    apiToken: envValue('CLOUDFLARE_API_TOKEN'),
  });
  const client = createHttpD1Client(transport);
  clientCache = { cacheKey, credentialFingerprint, fetcher, client };
  return client;
};
