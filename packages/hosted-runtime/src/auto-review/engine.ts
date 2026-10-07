import type { AutoReviewProviderEntry } from './config';
import { createAutoReviewBackend, DEFAULT_BACKEND_TIMEOUT_MS, type AutoReviewBackendDeps } from './backends';
import { extractAutoReviewContent } from './state';
import type {
  AutoReviewBackend,
  AutoReviewRoutingStrategy,
  ReviewInputCoverage,
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

/**
 * 超时通过 AbortSignal 中止底层请求（而非只停止等待）：
 * 超时即 abort，原请求退出，fallback 不会产生并行重复调用。
 */
const runBackendWithTimeout = async <T>(
  ms: number,
  fn: (_signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timeoutError = new Error(`auto-review backend timeout after ${ms}ms`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    // 无论成败都终止底层请求：成功后 abort 是 no-op，失败/超时确保请求离场。
    if (!controller.signal.aborted) controller.abort();
  }
};

/** 审核输入覆盖门禁：approve 仅在输入完整时成立；reject 允许落在截断输入上。 */
const enforceInputCoverage = (outcome: ReviewOutcome, coverage: ReviewInputCoverage): ReviewOutcome => {
  if (coverage.parseError) {
    return { ...outcome, verdict: 'uncertain', inputCoverage: coverage };
  }
  if (coverage.truncated && outcome.verdict === 'approve') {
    return { ...outcome, verdict: 'uncertain', inputCoverage: coverage };
  }
  return { ...outcome, inputCoverage: coverage };
};

export type AutoReviewRunResult = {
  outcome: ReviewOutcome;
  backendId: string;
  kind: AutoReviewBackend['kind'];
  latencyMs: number;
  /** 依次尝试过的后端（首个为实际采用） */
  attempted: string[];
  /** 生效的输入覆盖信息（门禁裁决所用口径） */
  inputCoverage: ReviewInputCoverage;
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
    typeof entry.timeoutMs === 'number' && entry.timeoutMs > 0
      ? entry.timeoutMs
      : DEFAULT_BACKEND_TIMEOUT_MS[entry.kind];

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
      const baseCoverage = extractAutoReviewContent(target).coverage;
      // 输入本身解析失败时没有任何可审内容，直接 uncertain，不消耗后端额度。
      if (baseCoverage.parseError) {
        return {
          outcome: {
            verdict: 'uncertain',
            score: 0.5,
            reason: 'auto-review input parse error',
            inputCoverage: baseCoverage,
          },
          backendId: 'none',
          kind: 'llm',
          latencyMs: 0,
          attempted: [],
          inputCoverage: baseCoverage,
        };
      }

      const ordered = orderBackendEntries(entries, strategyOverride ?? strategy, rng);
      const attempted: string[] = [];
      let lastError: unknown = null;
      for (const entry of ordered) {
        attempted.push(entry.id);
        const started = Date.now();
        try {
          const outcome = await runBackendWithTimeout(timeoutOf(entry), (signal) =>
            backendFor(entry).review(target, { signal }),
          );
          // 后端上报的覆盖信息优先（其内部抽取口径可能不同），缺省用标准口径。
          const coverage = outcome.inputCoverage ?? baseCoverage;
          return {
            outcome: enforceInputCoverage(outcome, coverage),
            backendId: entry.id,
            kind: backendFor(entry).kind,
            latencyMs: Date.now() - started,
            attempted,
            inputCoverage: coverage,
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
          inputCoverage: baseCoverage,
        },
        backendId: ordered[0]?.id ?? 'none',
        kind: ordered[0]?.kind ?? 'llm',
        latencyMs: 0,
        attempted,
        inputCoverage: baseCoverage,
      };
    },
  };
};
