import './configure-node-runtime';

import {
  defaultGenerateSublimationStreamService as hostedService,
} from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { observeNextDrService } from './observed-next-dr';

export { createDefaultGenerateSublimationStreamService } from '@mahoshojo/hosted-runtime/node-runtime/default-services';
export { hostedService };
export const defaultGenerateSublimationStreamService = observeNextDrService(
  'generate-sublimation-stream', hostedService,
);
export default defaultGenerateSublimationStreamService;
