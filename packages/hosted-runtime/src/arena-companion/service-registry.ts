import { ARENA_RECONCILIATION_PROTOCOL_VERSION } from '@mahoshojo/contracts/arena-reconciliation';
import { ARENA_COMPANION_PROTOCOL_HEADER, ARENA_COMPANION_PROTOCOL_VERSION } from '@mahoshojo/contracts/arena-companion';
import { createArenaCompanionResponseWriter } from './response';
import type {
  ArenaCompanionOperation,
  ArenaCompanionService,
} from './service';
import type { ArenaSessionCompanionService } from './session';

type ArenaCompanionRouteService = ArenaCompanionService
& ArenaSessionCompanionService
& Readonly<{ repairCombatantMeta(_request: Request): Promise<Response> }>;

let configuredService: ArenaCompanionRouteService | null = null;

export const configureArenaCompanionRouteService = (
  service: ArenaCompanionRouteService | null,
): void => {
  configuredService = service;
};

export const isArenaCompanionProtocolInstalled = (): boolean => configuredService?.companionProtocolVersion === ARENA_COMPANION_PROTOCOL_VERSION;

export const isArenaCompanionReconciliationProtocolInstalled = (): boolean => isArenaCompanionProtocolInstalled()
  && configuredService?.reconciliationProtocolVersion === ARENA_RECONCILIATION_PROTOCOL_VERSION;

const unavailable = (): Promise<Response> => Promise.resolve(new Response(JSON.stringify({
  code: 'ARENA_COMPANION_SERVICE_UNAVAILABLE',
  error: 'Arena companion service unavailable',
}), {
  status: 503,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  },
}));

export const registeredArenaCompanionRouteService: ArenaCompanionRouteService = Object.freeze({
  generate: (request: Request, operation?: ArenaCompanionOperation) => (
    configuredService?.generate(request, operation) ?? unavailable().then((response) => createArenaCompanionResponseWriter(request.headers.has(ARENA_COMPANION_PROTOCOL_HEADER)).upstream(response))
  ),
  generateNext: (request: Request) => configuredService?.generateNext(request) ?? unavailable(),
  repairCombatantMeta: (request: Request) => (
    configuredService?.repairCombatantMeta(request) ?? unavailable()
  ),
});
