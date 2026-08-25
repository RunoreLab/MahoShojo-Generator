import { generateWithAI } from '@/lib/ai';
import { config as appConfig } from '@/lib/config';
import { quickCheckForServer } from '@/lib/sensitive-word-filter';
import { createContentSafetyService } from '@mahoshojo/hosted-runtime/node-runtime/content-safety';

export type {
  AiSafetyPromptTemplate,
  EnforceTextSafetyInput,
  LoggerLike,
  SafetyCheckInput,
  SafetyCheckPolicy,
} from '@mahoshojo/hosted-runtime/node-runtime/content-safety';
export { buildPolicySafetyCheckText } from '@mahoshojo/hosted-runtime/node-runtime/content-safety';

const contentSafetyService = createContentSafetyService({
  defaults: {
    enableSensitiveWordFilter: appConfig.ENABLE_SENSITIVE_WORD_FILTER,
    enableAiSafetyCheck: appConfig.ENABLE_AI_SAFETY_CHECK,
  },
  quickCheck: quickCheckForServer,
  generateWithAI,
});

export const enforceTextSafety = contentSafetyService.enforceTextSafety;
