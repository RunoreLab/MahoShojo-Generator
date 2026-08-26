import 'server-only';
import type {
  DatabaseProvider,
  DatabaseSession,
} from '@mahoshojo/hosted-runtime/database-provider';
import {
  createHostedApiCorsPreflightResponse,
  HOSTED_API_CORS_ORIGINS_ENVIRONMENT,
  withHostedApiCorsHeaders,
} from '@mahoshojo/hosted-api/hosted-dr';
import hostedDrManifest from '../../../../config/hosted-dr-capabilities.json';

import { cloudflareDrDatabaseProvider } from '@/lib/hosted-dr/database-provider';

type HostedDrCapability = {
  id: string;
  operations: Array<{
    method: string;
    drMode: 'safe-read' | 'new-request-only' | 'fail-closed';
  }>;
  requiredSecrets: Array<{ name: string; minLength?: number }>;
  requiredBindings: string[];
  drDatabaseProvider: 'cloudflare-d1-binding';
  consistency: 'replica-ok' | 'primary';
};

type GuardUnavailableCategory =
  | 'contract'
  | 'method'
  | 'dr-mode'
  | 'cors'
  | 'secret'
  | 'binding'
  | 'database-provider';

type GuardUnavailableEvent = {
  capabilityId: string;
  category: GuardUnavailableCategory;
};

export type NextDrCapabilityGuardOptions = {
  executionEnvironment?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  provider?: DatabaseProvider;
  logUnavailable?(_event: GuardUnavailableEvent): void;
};

type NextRouteHandler<Args extends unknown[]> = (
  _request: Request,
  ..._args: Args
) => Response | Promise<Response>;

const capabilities = new Map(
  (hostedDrManifest.capabilities as HostedDrCapability[])
    .map((capability) => [capability.id, capability]),
);

const defaultLogUnavailable = (event: GuardUnavailableEvent): void => {
  console.error(JSON.stringify({
    event: 'hosted.dr.capability.unavailable',
    schemaVersion: 1,
    ...event,
  }));
};

const unavailableResponse = (): Response => new Response(JSON.stringify({
  code: 'HOSTED_DR_CAPABILITY_UNAVAILABLE',
  error: 'Hosted DR capability unavailable',
}), {
  status: 503,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  },
});

const methodNotAllowedResponse = (allow: string[]): Response => new Response(JSON.stringify({
  code: 'METHOD_NOT_ALLOWED',
  error: 'Method not allowed',
}), {
  status: 405,
  headers: {
    Allow: allow.join(', '),
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  },
});

const hasR2ObjectStoreConfiguration = (
  environment: Readonly<Record<string, string | undefined>>,
): boolean => {
  if (!environment.R2_BUCKET_NAME?.trim()) return false;
  const configuredEndpoint = environment.R2_ENDPOINT?.trim();
  if (configuredEndpoint) {
    try {
      const endpoint = new URL(configuredEndpoint);
      return endpoint.protocol === 'https:'
        && !endpoint.username
        && !endpoint.password
        && endpoint.pathname === '/'
        && !endpoint.search
        && !endpoint.hash;
    } catch {
      return false;
    }
  }
  return [
    environment.R2_ACCOUNT_ID,
    environment.CF_ACCOUNT_ID,
    environment.CLOUDFLARE_ACCOUNT_ID,
  ].some((value) => Boolean(value?.trim()));
};

const hasRequiredBindings = (
  bindings: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): boolean => bindings.every((binding) => {
  if (binding === 'DB') return true;
  if (binding === 'R2_OBJECT_STORE') return hasR2ObjectStoreConfiguration(environment);
  return false;
});

export const isExecutableHostedDrMode = (value: unknown): boolean => (
  value === 'safe-read' || value === 'new-request-only'
);

export const withNextDrCapability = <Args extends unknown[]>(
  capabilityId: string,
  handler: NextRouteHandler<Args>,
  options: NextDrCapabilityGuardOptions = {},
): NextRouteHandler<Args> => async (request, ...args) => {
  const executionEnvironment = options.executionEnvironment ?? process.env.NODE_ENV;
  if (executionEnvironment === 'development' || executionEnvironment === 'test') {
    return handler(request, ...args);
  }

  const logUnavailable = options.logUnavailable ?? defaultLogUnavailable;
  const capability = capabilities.get(capabilityId);
  if (!capability) {
    logUnavailable({ capabilityId, category: 'contract' });
    return unavailableResponse();
  }
  const environment = options.environment ?? process.env;
  const allowedOrigins = (environment[HOSTED_API_CORS_ORIGINS_ENVIRONMENT] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = request.headers.get('Origin');
  if (requestOrigin && allowedOrigins.length === 0) {
    logUnavailable({ capabilityId, category: 'cors' });
    return unavailableResponse();
  }
  if (request.method.toUpperCase() === 'OPTIONS') {
    return createHostedApiCorsPreflightResponse(request, allowedOrigins);
  }
  const respond = (response: Response): Response => withHostedApiCorsHeaders(
    request,
    response,
    allowedOrigins,
  );
  const method = request.method.toUpperCase();
  const operation = capability.operations.find((candidate) => candidate.method === method);
  if (!operation) {
    logUnavailable({ capabilityId, category: 'method' });
    return respond(methodNotAllowedResponse(
      capability.operations.map(({ method: allowed }) => allowed),
    ));
  }
  if (!isExecutableHostedDrMode(operation.drMode)) {
    logUnavailable({ capabilityId, category: 'dr-mode' });
    return respond(unavailableResponse());
  }

  for (const secret of capability.requiredSecrets) {
    const value = environment[secret.name]?.trim() ?? '';
    if (!value || (secret.minLength !== undefined && value.length < secret.minLength)) {
      logUnavailable({ capabilityId, category: 'secret' });
      return respond(unavailableResponse());
    }
  }
  if (!hasRequiredBindings(capability.requiredBindings, environment)) {
    logUnavailable({ capabilityId, category: 'binding' });
    return respond(unavailableResponse());
  }

  const provider = options.provider ?? cloudflareDrDatabaseProvider;
  if (provider.id !== capability.drDatabaseProvider) {
    logUnavailable({ capabilityId, category: 'database-provider' });
    return respond(unavailableResponse());
  }
  let session: DatabaseSession | null;
  try {
    session = provider.openSession({ consistency: capability.consistency });
  } catch {
    session = null;
  }
  if (!session) {
    logUnavailable({ capabilityId, category: 'database-provider' });
    return respond(unavailableResponse());
  }

  return respond(await handler(request, ...args));
};
