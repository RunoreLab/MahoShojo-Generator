import { getCloudflareDrArenaGenerationService } from '@/app/api/arena/generation-runtime';

/** Cloudflare/OpenNext DR adapter. Business execution lives in the shared service. */
export const appRouteHandler = (request: Request): Promise<Response> => (
  getCloudflareDrArenaGenerationService().create(request)
);

export default appRouteHandler;
