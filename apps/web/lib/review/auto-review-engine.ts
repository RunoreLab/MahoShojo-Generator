/**
 * 数据卡自动审查引擎胶水：把 hosted-runtime 的 auto-review 抽象接上
 * apps/web 的 env、generateWithAI 与 logger。
 */
import {
  createAutoReviewEngine,
  parseAutoReviewConfig,
  type AutoReviewEngine,
  type AutoReviewRunResult,
  type AutoReviewPolicy,
  type AutoReviewRoutingStrategy,
  type ReviewTarget,
} from '@mahoshojo/hosted-runtime/auto-review';

import { generateWithAI } from '@/lib/ai';
import { getLogger } from '@/lib/logger';

const log = getLogger('auto-review-engine');

let cachedEngine: AutoReviewEngine | null | undefined;
let cachedPolicy: AutoReviewPolicy | undefined;
let cachedStrategy: AutoReviewRoutingStrategy | undefined;

const policyOf = (): AutoReviewPolicy => {
  if (cachedPolicy === undefined) cachedPolicy = parseAutoReviewConfig(process.env).policy;
  return cachedPolicy;
};

/** 只读策略（豁免用户流转判断用），不触发引擎构建与后端告警。 */
export const getAutoReviewPolicy = (): AutoReviewPolicy => policyOf();

/** 懒加载并缓存引擎；无配置后端时返回 null（回退由调用方处理）。 */
export const getAutoReviewEngine = (): {
  engine: AutoReviewEngine | null;
  policy: AutoReviewPolicy;
  strategy: AutoReviewRoutingStrategy;
} => {
  if (cachedEngine === undefined) {
    const parsed = parseAutoReviewConfig(process.env);
    cachedPolicy = parsed.policy;
    cachedStrategy = parsed.routing.strategy;
    cachedEngine =
      parsed.providers.length > 0
        ? createAutoReviewEngine(parsed.providers, {
            env: process.env,
            generate: generateWithAI as never,
            strategy: parsed.routing.strategy,
            onBackendError: (backendId, error) => {
              log.warn('自动审查后端调用失败，尝试下一后端', { backendId, error });
            },
          })
        : null;
    // 显式配置但非法：诊断落日志，区别于完全未配置。
    if (parsed.errors.length > 0) {
      log.warn('AI 审查配置存在无效项（已跳过），请检查环境变量', { errors: parsed.errors });
    }
    if (!cachedEngine) {
      // r1 起不再回退 legacy 通路：无可用后端即视为无 AI 审查能力，内容保持 pending。
      log.warn('AI_REVIEW_PROVIDERS_CONFIG 未配置有效后端，自动审查不可用（不会回退旧通路）');
    }
  }
  return {
    engine: cachedEngine,
    policy: cachedPolicy!,
    strategy: cachedStrategy!,
  };
};

/** 仅供测试：清掉缓存的引擎单例。 */
export const resetAutoReviewEngineForTests = (): void => {
  cachedEngine = undefined;
  cachedPolicy = undefined;
  cachedStrategy = undefined;
};

export type { AutoReviewRunResult, ReviewTarget };
