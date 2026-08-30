import {
  registeredArenaCompanionRouteService,
  withArenaCompanionResponseMarkers,
} from '@mahoshojo/hosted-runtime/arena-companion';

export const POST = async (request: Request): Promise<Response> => withArenaCompanionResponseMarkers(
  await registeredArenaCompanionRouteService.generate(request, 'generate-battle-story'),
  { operation: 'generate-battle-story', placement: 'hono-primary' },
);
