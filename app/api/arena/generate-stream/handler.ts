import { getCloudflareDrArenaGenerationService } from '@/app/api/arena/generation-runtime';

/** Cloudflare/OpenNext DR adapter. Business execution lives in the shared service. */
export const appRouteHandler = (request: Request): Promise<Response> => (
  request.method === 'DELETE'
    ? getCloudflareDrArenaGenerationService().cancelRequest(request)
    : request.method === 'POST'
      ? getCloudflareDrArenaGenerationService().create(request)
      : Promise.resolve(new Response(JSON.stringify({
        code: 'METHOD_NOT_ALLOWED',
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: {
          Allow: 'POST, DELETE',
          'Content-Type': 'application/json; charset=utf-8',
        },
      }))
);

export default appRouteHandler;
