import {
  registeredArenaCompanionRouteService,
  withArenaCompanionResponseMarkers,
} from '@mahoshojo/hosted-runtime/arena-companion';

export const POST = async (request: Request): Promise<Response> => withArenaCompanionResponseMarkers(
  await registeredArenaCompanionRouteService.generate(request, 'arena/generate'),
  { operation: 'arena/generate', placement: 'hono-primary' },
);
