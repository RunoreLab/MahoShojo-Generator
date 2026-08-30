import {
  createHostedDrReadinessService,
  type HostedDrReadinessService,
} from '@mahoshojo/hosted-api/hosted-dr';
import type { DatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';

import { cloudflareDrDatabaseProvider } from '@/lib/hosted-dr/database-provider';
import {
  type NextDrCapabilityGuardOptions,
  withNextDrCapability,
} from '@/lib/hosted-dr/capability-guard';
import {
  HOSTED_DR_CAPABILITY_HEADER,
  HOSTED_DR_OPERATION_METHOD_HEADER,
  type HostedDrProbeTarget,
} from '@/lib/hosted-dr/probe-contract';

const invalidTargetResponse = (): Response => Response.json({
  ok: false,
  code: 'HOSTED_DR_CAPABILITY_UNAVAILABLE',
}, {
  status: 503,
  headers: { 'Cache-Control': 'no-store' },
});

const readProbeTarget = (request: Request): HostedDrProbeTarget | null | 'invalid' => {
  const capabilityId = request.headers.get(HOSTED_DR_CAPABILITY_HEADER)?.trim() ?? '';
  const operationMethod = request.headers.get(HOSTED_DR_OPERATION_METHOD_HEADER)?.trim().toUpperCase() ?? '';
  if (!capabilityId && !operationMethod) return null;
  if (
    !/^[a-z0-9_/\[\]-]{1,160}$/u.test(capabilityId)
    || !/^[A-Z]{3,12}$/u.test(operationMethod)
  ) {
    return 'invalid';
  }
  return { capabilityId, operationMethod };
};

export const createNextDrReadinessHandler = (
  provider: DatabaseProvider,
  guardOptions: NextDrCapabilityGuardOptions = {},
): HostedDrReadinessService => async (request) => {
  const target = readProbeTarget(request);
  if (target === 'invalid') return invalidTargetResponse();
  const service = createHostedDrReadinessService({
    placement: 'next-dr',
    provider,
    ...(target ? { target } : {}),
  });
  if (!target) return service(request);
  return withNextDrCapability(
    target.capabilityId,
    service,
    {
      ...guardOptions,
      provider,
      operationMethod: target.operationMethod,
    },
  )(request);
};

export const appRouteHandler = createNextDrReadinessHandler(
  cloudflareDrDatabaseProvider,
);
