import { verifyActivityToken } from '@/lib/auth/activity-token';
import {
  buildPublicAiRateLimitResponse,
  createPublicAiRateLimiter,
  inferPublicAiProviderMode,
} from '@mahoshojo/hosted-runtime/node-runtime/public-rate-limit';

export type * from '@mahoshojo/hosted-runtime/node-runtime/public-rate-limit';
export { buildPublicAiRateLimitResponse, inferPublicAiProviderMode };

const limiter = createPublicAiRateLimiter({ verifyActivityToken });

export const acquirePublicAiRateLimit = limiter.acquirePublicAiRateLimit;
export const __resetPublicAiRateLimitForTest = limiter.resetForTest;
