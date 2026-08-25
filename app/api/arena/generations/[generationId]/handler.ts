import { getCloudflareDrArenaGenerationService } from '@/app/api/arena/generation-runtime';

export const appRouteHandler = async (
  request: Request,
  context: { params: Promise<{ generationId: string }> },
): Promise<Response> => {
  const { generationId } = await context.params;
  return getCloudflareDrArenaGenerationService().status(request, { generationId });
};
