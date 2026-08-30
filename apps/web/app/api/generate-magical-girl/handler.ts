export {
  MAGICAL_GIRL_NAME_MAX_LENGTH,
  type MagicalGirlGenerationResult as AIGeneratedMagicalGirl,
} from '@mahoshojo/hosted-api/generate-magical-girl';
export {
  generateMagicalGirlWithAI,
  type MainColor,
} from '@/lib/hosted-api/generate-magical-girl';
import { defaultGenerateMagicalGirlService } from '@/lib/hosted-api/generate-magical-girl';

export const appRouteHandler = defaultGenerateMagicalGirlService;
export default appRouteHandler;
