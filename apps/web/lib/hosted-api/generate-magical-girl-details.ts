import './configure-node-runtime';

import {
  defaultGenerateMagicalGirlDetailsService as hostedService,
} from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { observeNextDrService } from './observed-next-dr';

export { createDefaultGenerateMagicalGirlDetailsService } from '@mahoshojo/hosted-runtime/node-runtime/default-services';
export { hostedService };
export const defaultGenerateMagicalGirlDetailsService = observeNextDrService(
  'generate-magical-girl-details', hostedService,
);
export default defaultGenerateMagicalGirlDetailsService;
