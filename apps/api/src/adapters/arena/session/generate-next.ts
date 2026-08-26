import {
  registeredArenaCompanionRouteService,
  withArenaCompanionResponseMarkers,
} from '@mahoshojo/hosted-runtime/arena-companion';

export const POST = async (request: Request): Promise<Response> => withArenaCompanionResponseMarkers(
  await registeredArenaCompanionRouteService.generateNext(request),
  { operation: 'arena/session/generate-next', placement: 'hono-primary' },
);
