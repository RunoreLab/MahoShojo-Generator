import 'server-only';
import type {
  DatabaseProvider,
  DatabaseSession,
} from '@mahoshojo/hosted-runtime/database-provider';
import {
  createHostedApiCorsPreflightResponse,
  hasValidHostedApiProductionCorsOrigins,
  HOSTED_API_CORS_ORIGINS_ENVIRONMENT,
  parseHostedApiDeploymentTarget,
  withHostedApiCorsHeaders,
} from '@mahoshojo/hosted-api/hosted-dr';

import { hostedDrClientOperations } from '@/config/hosted-routing';
import { cloudflareDrDatabaseProvider } from '@/lib/hosted-dr/database-provider';

type GuardUnavailableCategory =
  | 'environment'
  | 'contract'
  | 'method'
  | 'operation-safety'
  | 'cors'
  | 'secret'
  | 'binding'
  | 'database-provider';

type GuardUnavailableEvent = {
  capabilityId: string;
  category: GuardUnavailableCategory;
};

export type NextDrCapabilityGuardOptions = {
  deploymentTarget?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  provider?: DatabaseProvider;
  operationMethod?: string;
  logUnavailable?(_event: GuardUnavailableEvent): void;
};

type NextRouteHandler<Args extends unknown[]> = (
  _request: Request,
  ..._args: Args
) => Response | Promise<Response>;

const operationsByCapability = new Map<string, typeof hostedDrClientOperations>();
for (const operation of hostedDrClientOperations) {
  const capabilityId = operation.route.slice('/api/'.length);
  operationsByCapability.set(
    capabilityId,
    Object.freeze([
      ...(operationsByCapability.get(capabilityId) ?? []),
      operation,
    ]),
  );
}

const SIGNED_CAPABILITIES = new Set([
  'creator/generate',
  'creator/generate-stream',
  'generate-canshou',
  'generate-canshou-stream',
  'generate-magical-girl',
  'generate-magical-girl-details',
  'generate-magical-girl-details-stream',
  'generate-scenario',
  'generate-sublimation',
  'generate-sublimation-stream',
]);

const R2_CAPABILITIES = new Set([
  'arena/generations/[generationId]/stream',
]);

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

export const isExecutableHostedDrOperationSafety = (value: unknown): boolean => (
  value === 'safe-read' || value === 'new-non-idempotent'
);

export const withNextDrCapability = <Args extends unknown[]>(
  capabilityId: string,
  handler: NextRouteHandler<Args>,
  options: NextDrCapabilityGuardOptions = {},
): NextRouteHandler<Args> => async (request, ...args) => {
  const logUnavailable = options.logUnavailable ?? defaultLogUnavailable;
  const deploymentTarget = parseHostedApiDeploymentTarget(
    options.deploymentTarget ?? process.env.NEXT_PUBLIC_HOSTED_API_ENVIRONMENT,
  );
  if (deploymentTarget === 'local' || deploymentTarget === 'test') {
    return handler(request, ...args);
  }
  if (deploymentTarget !== 'production' && deploymentTarget !== 'preview') {
    logUnavailable({ capabilityId, category: 'environment' });
    return unavailableResponse();
  }

  const operations = operationsByCapability.get(capabilityId);
  if (!operations) {
    logUnavailable({ capabilityId, category: 'contract' });
    return unavailableResponse();
  }
  const environment = options.environment ?? process.env;
  const allowedOrigins = (environment[HOSTED_API_CORS_ORIGINS_ENVIRONMENT] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!hasValidHostedApiProductionCorsOrigins(allowedOrigins)) {
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
  const method = (options.operationMethod ?? request.method).trim().toUpperCase();
  const operation = operations.find((candidate) => candidate.method === method);
  if (!operation) {
    logUnavailable({ capabilityId, category: 'method' });
    return respond(methodNotAllowedResponse(
      operations.map(({ method: allowed }) => allowed),
    ));
  }
  if (!isExecutableHostedDrOperationSafety(operation.safety)) {
    logUnavailable({ capabilityId, category: 'operation-safety' });
    return respond(unavailableResponse());
  }

  if (
    SIGNED_CAPABILITIES.has(capabilityId)
    && (environment.SIGNATURE_SECRET_KEY?.trim().length ?? 0) < 32
  ) {
    logUnavailable({ capabilityId, category: 'secret' });
    return respond(unavailableResponse());
  }
  if (R2_CAPABILITIES.has(capabilityId)) {
    if (!environment.R2_ACCESS_KEY_ID?.trim() || !environment.R2_SECRET_ACCESS_KEY?.trim()) {
      logUnavailable({ capabilityId, category: 'secret' });
      return respond(unavailableResponse());
    }
    if (!hasR2ObjectStoreConfiguration(environment)) {
      logUnavailable({ capabilityId, category: 'binding' });
      return respond(unavailableResponse());
    }
  }

  const provider = options.provider ?? cloudflareDrDatabaseProvider;
  if (provider.id !== 'cloudflare-d1-binding') {
    logUnavailable({ capabilityId, category: 'database-provider' });
    return respond(unavailableResponse());
  }
  let session: DatabaseSession | null;
  try {
    session = provider.openSession({ consistency: 'primary' });
  } catch {
    session = null;
  }
  if (!session) {
    logUnavailable({ capabilityId, category: 'database-provider' });
    return respond(unavailableResponse());
  }

  return respond(await handler(request, ...args));
};
