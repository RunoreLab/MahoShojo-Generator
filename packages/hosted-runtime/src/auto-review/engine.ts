import type { AutoReviewProviderEntry } from './config';
import { createAutoReviewBackend, withTimeout, type AutoReviewBackendDeps } from './backends';
import type {
  AutoReviewBackend,
  AutoReviewRoutingStrategy,
  ReviewOutcome,
  ReviewTarget,
} from './types';

/**
 * 路由：为单卡选后端执行顺序。
 * - priority：按配置数组顺序；
 * - weighted-random：按 weight 随机选首个，其余按声明顺序作失败回退。
 * 单模型单审——不做多后端结果合并。
 */

const pickWeightedIndex = (weights: number[], rng: () => number): number => {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
};

export const orderBackendEntries = (
  entries: readonly AutoReviewProviderEntry[],
  strategy: AutoReviewRoutingStrategy,
  rng: () => number = Math.random,
): AutoReviewProviderEntry[] => {
  if (entries.length <= 1 || strategy === 'priority') return [...entries];
  const weights = entries.map((e) => (typeof e.weight === 'number' && e.weight > 0 ? e.weight : 1));
  const firstIdx = pickWeightedIndex(weights, rng);
  const first = entries[firstIdx];
  return [first, ...entries.filter((_, i) => i !== firstIdx)];
};

export type AutoReviewRunResult = {
  outcome: ReviewOutcome;
  backendId: string;
  kind: AutoReviewBackend['kind'];
  latencyMs: number;
  /** 依次尝试过的后端（首个为实际采用） */
  attempted: string[];
};

export type AutoReviewEngine = {
  backends: AutoReviewBackend[];
  review(_target: ReviewTarget, _strategy?: AutoReviewRoutingStrategy): Promise<AutoReviewRunResult>;
};

export type AutoReviewEngineDeps = AutoReviewBackendDeps & {
  strategy?: AutoReviewRoutingStrategy;
  rng?: () => number;
  /** 后端异常回调（日志） */
  onBackendError?: (_backendId: string, _error: unknown) => void;
};

export const createAutoReviewEngine = (
  entries: readonly AutoReviewProviderEntry[],
  deps: AutoReviewEngineDeps,
): AutoReviewEngine => {
  const env = deps.env ?? {};
  const timeoutOf = (entry: AutoReviewProviderEntry) =>
    typeof entry.timeoutMs === 'number' && entry.timeoutMs > 0 ? entry.timeoutMs : 60_000;

  const instances = new Map<AutoReviewProviderEntry, AutoReviewBackend>();
  const backendFor = (entry: AutoReviewProviderEntry): AutoReviewBackend => {
    let b = instances.get(entry);
    if (!b) {
      b = createAutoReviewBackend(entry, { fetch: deps.fetch, env, generate: deps.generate });
      instances.set(entry, b);
    }
    return b;
  };

  const strategy = deps.strategy ?? 'priority';
  const rng = deps.rng ?? Math.random;

  return {
    get backends() {
      return entries.map(backendFor);
    },
    review: async (target, strategyOverride) => {
      const ordered = orderBackendEntries(entries, strategyOverride ?? strategy, rng);
      const attempted: string[] = [];
      let lastError: unknown = null;
      for (const entry of ordered) {
        attempted.push(entry.id);
        const started = Date.now();
        try {
          const outcome = await withTimeout(backendFor(entry).review(target), timeoutOf(entry));
          return {
            outcome,
            backendId: entry.id,
            kind: backendFor(entry).kind,
            latencyMs: Date.now() - started,
            attempted,
          };
        } catch (error) {
          lastError = error;
          deps.onBackendError?.(entry.id, error);
        }
      }
      // fail-closed：全部后端失败按 uncertain 交给策略层裁决，不误放行。
      return {
        outcome: {
          verdict: 'uncertain',
          score: 0.5,
          reason: `auto-review unavailable: ${lastError instanceof Error ? lastError.message.slice(0, 120) : 'unknown'}`,
        },
        backendId: ordered[0]?.id ?? 'none',
        kind: ordered[0]?.kind ?? 'llm',
        latencyMs: 0,
        attempted,
      };
    },
  };
};
