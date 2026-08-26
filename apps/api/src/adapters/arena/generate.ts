import { registeredArenaCompanionRouteService } from '@mahoshojo/hosted-runtime/arena-companion';

export const POST = (request: Request): Promise<Response> => (
  registeredArenaCompanionRouteService.generate(request, 'arena/generate')
);
