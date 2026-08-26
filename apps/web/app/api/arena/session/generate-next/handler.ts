import { getCloudflareDrArenaCompanionService } from '@/app/api/arena/companion-runtime';
import { withArenaCompanionResponseMarkers } from '@mahoshojo/hosted-runtime/arena-companion';

export {
  buildArenaSessionUpstreamRequestBody as buildUpstreamRequestBody,
} from '@mahoshojo/hosted-runtime/arena-companion';

const handler = async (request: Request): Promise<Response> => withArenaCompanionResponseMarkers(
  await getCloudflareDrArenaCompanionService().generateNext(request),
  { operation: 'arena/session/generate-next', placement: 'next-dr' },
);

export const appRouteHandler = handler;
export default appRouteHandler;
