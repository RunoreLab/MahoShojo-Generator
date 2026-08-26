import type { ArenaCompanionRouteService } from './index';
import type { ArenaCompanionOperation } from './service';

let configuredService: ArenaCompanionRouteService | null = null;

export const configureArenaCompanionRouteService = (
  service: ArenaCompanionRouteService | null,
): void => {
  configuredService = service;
};

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
    configuredService?.generate(request, operation) ?? unavailable()
  ),
  generateNext: (request: Request) => configuredService?.generateNext(request) ?? unavailable(),
});
