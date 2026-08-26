import { defaultGenerateMagicalGirlDetailsStreamService } from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { observeHonoHostedGenerationService } from './hosted-generation-lifecycle';

export const hostedService = defaultGenerateMagicalGirlDetailsStreamService;
const honoRouteHandler = observeHonoHostedGenerationService(
  'generate-magical-girl-details-stream', hostedService,
);

export const GET = honoRouteHandler;
export const HEAD = honoRouteHandler;
export const OPTIONS = honoRouteHandler;
export const POST = honoRouteHandler;
export const PUT = honoRouteHandler;
export const PATCH = honoRouteHandler;
export const DELETE = honoRouteHandler;
