import { getCloudflareDrArenaCompanionService } from '@/app/api/arena/companion-runtime';

export {
  buildArenaSessionUpstreamRequestBody as buildUpstreamRequestBody,
} from '@mahoshojo/hosted-runtime/arena-companion';

const handler = (request: Request): Promise<Response> => (
  getCloudflareDrArenaCompanionService().generateNext(request)
);

export const appRouteHandler = handler;
export default appRouteHandler;
