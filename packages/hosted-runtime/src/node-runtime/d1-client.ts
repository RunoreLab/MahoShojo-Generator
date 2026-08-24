import {
  createD1HttpTransport,
  createHttpD1Client,
  type D1HttpClient,
} from '../d1-http-client';

export type NodeD1Environment = Record<string, string | undefined>;

export type CreateNodeD1ClientOptions = {
  env?: NodeD1Environment;
  fetch?: typeof globalThis.fetch;
};

const envValue = (env: NodeD1Environment, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value || undefined;
};

const runtimeEnvironment = (): NodeD1Environment => (
  typeof process === 'undefined' ? {} : process.env
);

const configurationKey = (
  env: NodeD1Environment,
): string => JSON.stringify([
  envValue(env, 'D1_GATEWAY_URL') ?? '',
  envValue(env, 'D1_DATABASE_ID') ?? '',
  envValue(env, 'CLOUDFLARE_ACCOUNT_ID') ?? '',
]);

const credentialFingerprint = (
  env: NodeD1Environment,
): string => JSON.stringify([
  envValue(env, 'CLOUDFLARE_API_TOKEN') ?? '',
  envValue(env, 'D1_GATEWAY_TOKEN') ?? '',
  envValue(env, 'D1_GATEWAY_HMAC_SECRET') ?? '',
  envValue(env, 'CF_ACCESS_CLIENT_ID') ?? '',
  envValue(env, 'CF_ACCESS_CLIENT_SECRET') ?? '',
]);

export const createNodeD1ClientFromEnvironment = (
  options: CreateNodeD1ClientOptions = {},
): D1HttpClient | null => {
  const env = options.env ?? runtimeEnvironment();
  const fetcher = options.fetch ?? globalThis.fetch;
  const gatewayUrl = envValue(env, 'D1_GATEWAY_URL');
  if (gatewayUrl) {
    return createHttpD1Client(createD1HttpTransport({
      kind: 'gateway',
      baseUrl: gatewayUrl,
      token: envValue(env, 'D1_GATEWAY_TOKEN'),
      hmacSecret: envValue(env, 'D1_GATEWAY_HMAC_SECRET'),
      accessClientId: envValue(env, 'CF_ACCESS_CLIENT_ID'),
      accessClientSecret: envValue(env, 'CF_ACCESS_CLIENT_SECRET'),
      fetch: fetcher,
    }));
  }

  const accountId = envValue(env, 'CLOUDFLARE_ACCOUNT_ID');
  const databaseId = envValue(env, 'D1_DATABASE_ID');
  const apiToken = envValue(env, 'CLOUDFLARE_API_TOKEN');
  if (!accountId || !databaseId || !apiToken) return null;

  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;
  return createHttpD1Client(createD1HttpTransport({
    kind: 'cloudflare-api',
    queryUrl: `${baseUrl}/query`,
    rawUrl: `${baseUrl}/raw`,
    apiToken,
    fetch: fetcher,
  }));
};

let defaultClientCache: {
  configurationKey: string;
  credentialFingerprint: string;
  fetcher: typeof globalThis.fetch;
  client: D1HttpClient | null;
} | undefined;

export const getDefaultNodeD1Client = (): D1HttpClient | null => {
  const env = runtimeEnvironment();
  const fetcher = globalThis.fetch;
  const nextConfigurationKey = configurationKey(env);
  const nextCredentialFingerprint = credentialFingerprint(env);
  const cached = defaultClientCache;
  if (
    cached?.configurationKey === nextConfigurationKey
    && cached.credentialFingerprint === nextCredentialFingerprint
    && cached.fetcher === fetcher
  ) {
    return cached.client;
  }

  const client = createNodeD1ClientFromEnvironment({ env, fetch: fetcher });
  defaultClientCache = {
    configurationKey: nextConfigurationKey,
    credentialFingerprint: nextCredentialFingerprint,
    fetcher,
    client,
  };
  return client;
};
