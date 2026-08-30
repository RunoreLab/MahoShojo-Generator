import { registeredArenaGenerationService } from '@mahoshojo/hosted-runtime/arena-generation';

export const POST = (request: Request): Promise<Response> => (
  registeredArenaGenerationService.create(request)
);

export const DELETE = (request: Request): Promise<Response> => (
  registeredArenaGenerationService.cancelRequest(request)
);
