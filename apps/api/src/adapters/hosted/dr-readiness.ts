import { isArenaCompanionProtocolInstalled } from '@mahoshojo/hosted-runtime/arena-companion';
import { ARENA_COMPANION_PROTOCOL_HEADER, ARENA_COMPANION_PROTOCOL_VERSION } from '@mahoshojo/contracts/arena-companion';
import {
  createHostedDrReadinessService,
  type HostedDrReadinessDatabaseProvider,
  type HostedDrReadinessService,
} from '@mahoshojo/hosted-api/hosted-dr';
import { DESKTOP_ARENA_HOSTED_CAPABILITY } from '@mahoshojo/contracts/desktop-arena-hosted';
import { isArenaHostedIdentityAssertionInstalled } from '@mahoshojo/hosted-runtime/arena-generation';
import { honoPrimaryDatabaseProvider } from '#/d1/provider';

export const createHonoDrReadinessHandler = (
  provider: HostedDrReadinessDatabaseProvider,
  hasArenaIdentityAssertion: () => boolean = isArenaHostedIdentityAssertionInstalled,
  hasArenaCompanionProtocol: () => boolean = isArenaCompanionProtocolInstalled,
): HostedDrReadinessService => {
  const shared = createHostedDrReadinessService({ placement: 'hono-primary', provider });
  return async (request) => {
    const response = await shared(request);
    if (!response.ok || request.method !== 'GET' || !hasArenaIdentityAssertion()) return response;
    const payload = await response.json();
    const headers = new Headers(response.headers);
    if (hasArenaCompanionProtocol()) headers.set(ARENA_COMPANION_PROTOCOL_HEADER, ARENA_COMPANION_PROTOCOL_VERSION);
    return new Response(JSON.stringify({ ...payload, arenaHosted: DESKTOP_ARENA_HOSTED_CAPABILITY }), {
      status: response.status, headers,
    });
  };
};

const honoDrReadinessHandler = createHonoDrReadinessHandler(honoPrimaryDatabaseProvider);

export const GET = honoDrReadinessHandler;
export const HEAD = honoDrReadinessHandler;
