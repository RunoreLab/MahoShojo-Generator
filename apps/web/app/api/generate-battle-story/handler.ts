import { getCloudflareDrArenaCompanionService } from '@/app/api/arena/companion-runtime';

const handler = (request: Request): Promise<Response> => (
  getCloudflareDrArenaCompanionService().generate(request, 'generate-battle-story')
);

export const appRouteHandler = handler;
export default appRouteHandler;
