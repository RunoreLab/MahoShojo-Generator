import {
  createGenerateMagicalGirlRuntime,
  type AIGeneratedMagicalGirl,
  type MainColor,
} from '@mahoshojo/hosted-runtime/generate-magical-girl-runtime';
import { generateWithAI } from '@/lib/ai';
import { OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS } from '@/lib/ai/cooldowns';
import {
  acquirePublicAiRateLimit,
  buildPublicAiRateLimitResponse,
} from '@/lib/ai/public-rate-limit';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { generateSignature } from '@/lib/signature';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-gen-girl');

const defaultGenerateMagicalGirlRuntime = createGenerateMagicalGirlRuntime({
  checkRateLimit: async ({ request, actionType, providerMode }) => {
    const rateLimit = await acquirePublicAiRateLimit({
      req: request,
      actionType,
      providerMode,
    });
    return rateLimit.allowed ? null : buildPublicAiRateLimitResponse(rateLimit);
  },
  enforceSafety: async ({ name, language }) => enforceTextSafety({
    text: name,
    log,
    logMeta: {
      nameLength: name.length,
      language,
    },
    enableAiSafetyCheck: false,
    sensitiveWordReason: '使用危险符文',
  }),
  generateWithAI,
  sign: generateSignature,
  recordActivity: recordUserActivityFromRequest,
  logError: (error, { name }) => {
    log.error('生成魔法少女失败', { error, name });
  },
  cooldownMs: OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS,
});

export const defaultGenerateMagicalGirlService = defaultGenerateMagicalGirlRuntime.service;
export const generateMagicalGirlWithAI = defaultGenerateMagicalGirlRuntime.generateMagicalGirlWithAI;

export type { AIGeneratedMagicalGirl, MainColor };
