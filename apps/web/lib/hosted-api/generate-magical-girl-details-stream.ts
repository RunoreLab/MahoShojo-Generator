import './configure-node-runtime';

import {
  defaultGenerateMagicalGirlDetailsStreamService as hostedService,
} from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { observeNextDrService } from './observed-next-dr';

export { createDefaultGenerateMagicalGirlDetailsStreamService } from '@mahoshojo/hosted-runtime/node-runtime/default-services';
export { hostedService };
export const defaultGenerateMagicalGirlDetailsStreamService = observeNextDrService(
  'generate-magical-girl-details-stream', hostedService,
);
export default defaultGenerateMagicalGirlDetailsStreamService;
