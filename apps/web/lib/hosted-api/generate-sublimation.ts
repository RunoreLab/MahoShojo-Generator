import './configure-node-runtime';

import {
  defaultGenerateSublimationService as hostedService,
} from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { observeNextDrService } from './observed-next-dr';

export { createDefaultGenerateSublimationService } from '@mahoshojo/hosted-runtime/node-runtime/default-services';
export { hostedService };
export const defaultGenerateSublimationService = observeNextDrService(
  'generate-sublimation', hostedService,
);
export default defaultGenerateSublimationService;
