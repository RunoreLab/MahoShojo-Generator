import { registeredArenaGenerationService } from '@mahoshojo/hosted-runtime/arena-generation';
import type { RouteContext } from '#/routes/types';

export const GET = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params;
  return registeredArenaGenerationService.status(request, {
    generationId: params.generationId ?? '',
  });
};
