import { getCloudflareDrArenaGenerationService } from '@/app/api/arena/generation-runtime';

export const appRouteHandler = async (
  request: Request,
  context: { params: Promise<{ generationRequestId: string }> },
): Promise<Response> => {
  const { generationRequestId } = await context.params;
  return getCloudflareDrArenaGenerationService().lookup(request, { generationRequestId });
};
