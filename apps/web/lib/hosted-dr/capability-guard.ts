import 'server-only';
import type { DatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
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
  const method = request.method.toUpperCase();
  const operation = capability.operations.find((candidate) => candidate.method === method);
  if (!operation) {
    logUnavailable({ capabilityId, category: 'method' });
    return methodNotAllowedResponse(capability.operations.map(({ method: allowed }) => allowed));
  }
  if (operation.drMode === 'fail-closed') {
    logUnavailable({ capabilityId, category: 'dr-mode' });
    return unavailableResponse();
  }

  const environment = options.environment ?? process.env;
  for (const secret of capability.requiredSecrets) {
    const value = environment[secret.name]?.trim() ?? '';
    if (!value || (secret.minLength !== undefined && value.length < secret.minLength)) {
      logUnavailable({ capabilityId, category: 'secret' });
      return unavailableResponse();
    }
  }
  if (capability.requiredBindings.some((binding) => binding !== 'DB')) {
    logUnavailable({ capabilityId, category: 'binding' });
    return unavailableResponse();
  }

  const provider = options.provider ?? cloudflareDrDatabaseProvider;
  if (provider.id !== capability.drDatabaseProvider) {
    logUnavailable({ capabilityId, category: 'database-provider' });
    return unavailableResponse();
  }
  const session = provider.openSession({ consistency: capability.consistency });
  if (!session) {
    logUnavailable({ capabilityId, category: 'database-provider' });
    return unavailableResponse();
  }

  return handler(request, ...args);
};
