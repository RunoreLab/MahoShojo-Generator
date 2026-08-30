import { getCloudflareDrArenaCompanionService } from '@/app/api/arena/companion-runtime';
import { withArenaCompanionResponseMarkers } from '@mahoshojo/hosted-runtime/arena-companion';

const handler = async (request: Request): Promise<Response> => withArenaCompanionResponseMarkers(
  await getCloudflareDrArenaCompanionService().generate(request, 'generate-battle-story'),
  { operation: 'generate-battle-story', placement: 'next-dr' },
);

export const appRouteHandler = handler;
export default appRouteHandler;
