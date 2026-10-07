import { z } from 'zod/v3';

import type {
  AutoReviewBackendKind,
  AutoReviewExemptPolicy,
  AutoReviewPolicy,
  AutoReviewRoutingStrategy,
  AutoReviewUncertainPolicy,
} from './types';
import { DEFAULT_AUTO_REVIEW_POLICY } from './types';

/**
 * AI_REVIEW_PROVIDERS_CONFIG 条目解析与实测默认阈值登记。
 * 阈值默认值来自 .tmp/safety-eval 实测（见设计文档），条目内 thresholds
 * 覆盖优先；未登记模型的缺省值按 kind 通用值回退。
 */

const thresholdsSchema = z
  .object({
    rejectAt: z.number().min(0).max(1).optional(),
    approveBelow: z.number().min(0).max(1).optional(),
    useOverallVeto: z.boolean().optional(),
    overallVetoAt: z.number().min(0).max(1).optional(),
    catVetoAt: z.number().min(0).max(1).optional(),
    usePassVeto: z.boolean().optional(),
    passRejectAt: z.number().min(0).max(1).optional(),
    useFlagged: z.boolean().optional(),
  })
  .strict();
export type AutoReviewThresholds = z.infer<typeof thresholdsSchema>;

const baseEntry = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['jev-decisions', 'omni-moderation', 'nemotron', 'llm']),
    weight: z.number().positive().optional(),
    thresholds: thresholdsSchema.optional(),
    timeoutMs: z.number().positive().optional(),
  })
  .strict();

const jevEntrySchema = baseEntry.extend({
  kind: z.literal('jev-decisions'),
  /** "workers-ai" 组装 CF REST URL，或显式 decisions endpoint（如 OpenRouter） */
  endpoint: z.string().min(1),
  accountId: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).optional(),
  model: z.string().min(1),
});

const omniEntrySchema = baseEntry.extend({
  kind: z.literal('omni-moderation'),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).optional(),
  model: z.string().min(1).default('omni-moderation-latest'),
});

const nemotronEntrySchema = baseEntry.extend({
  kind: z.literal('nemotron'),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).optional(),
  model: z.string().min(1).default('nvidia/nemotron-3.5-content-safety'),
  options: z.object({ customPolicy: z.string().optional() }).strict().optional(),
});

const llmEntrySchema = baseEntry.extend({
  kind: z.literal('llm'),
  /** 走 generateWithAI 池内 modelOverride（可选） */
  modelOverride: z.string().min(1).optional(),
});

const entrySchema = z.discriminatedUnion('kind', [
  jevEntrySchema,
  omniEntrySchema,
  nemotronEntrySchema,
  llmEntrySchema,
]);
export type AutoReviewProviderEntry = z.infer<typeof entrySchema>;

/** 实测调优默认（kind + model 精确命中优先，其次 kind 通用值）。 */
const TUNED_DEFAULTS: Record<string, AutoReviewThresholds> = {
  'jev-decisions:clef-flash': { rejectAt: 0.5, approveBelow: 0.2 },
  'jev-decisions:clef': { rejectAt: 0.5, approveBelow: 0.2 },
  'jev-decisions:inception/mercury-decide': {
    rejectAt: 0.5,
    approveBelow: 0.2,
    useOverallVeto: true,
    overallVetoAt: 0.5,
    catVetoAt: 0.7,
  },
  'jev-decisions:respan/span-01-lite': {
    approveBelow: 0.3,
    catVetoAt: 0.7,
    usePassVeto: true,
    passRejectAt: 0.5,
  },
  'jev-decisions:*': { rejectAt: 0.5, approveBelow: 0.2 },
  'omni-moderation:*': { useFlagged: true, approveBelow: 0.5 },
  'nemotron:*': {},
  'llm:*': {},
};

const modelKeyOf = (entry: AutoReviewProviderEntry): string =>
  entry.kind === 'jev-decisions' || entry.kind === 'omni-moderation' || entry.kind === 'nemotron'
    ? `${entry.kind}:${entry.model}`
    : `${entry.kind}:*`;

export const resolveAutoReviewThresholds = (
  entry: AutoReviewProviderEntry,
): AutoReviewThresholds => {
  const specific = TUNED_DEFAULTS[modelKeyOf(entry)] ?? {};
  const generic = TUNED_DEFAULTS[`${entry.kind}:*`] ?? {};
  return { ...generic, ...specific, ...(entry.thresholds ?? {}) };
};

export type AutoReviewRouting = { strategy: AutoReviewRoutingStrategy };

const routingSchema = z.object({
  strategy: z.enum(['priority', 'weighted-random']),
}).strict();

const policySchema = z.object({
  onUncertain: z.enum(['normal', 'hold', 'approve', 'reject']).optional(),
  exemptUserPolicy: z.enum(['skip', 'review']).optional(),
  notifyOnAutoReject: z.boolean().optional(),
}).strict();

export type ParsedAutoReviewConfig = {
  providers: AutoReviewProviderEntry[];
  routing: AutoReviewRouting;
  policy: AutoReviewPolicy;
  /**
   * 配置诊断：显式给出但非法/不完整的配置在此收集（JSON 语法错误、schema
   * 违规、重复 id、workers-ai 缺凭据等）。合法条目仍进入 providers；
   * 没有任何可用后端时自动审查不运行（fail-to-pending），绝不回退 legacy 通路。
   */
  errors: string[];
};

const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const isHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const zodIssuesSummary = (issues: readonly z.ZodIssue[]): string =>
  issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');

/** 解析单个 JSON 字段：未提供→fallback；提供了但非法→记录 error 并 fallback。 */
const parseJsonField = <T>(
  raw: string | undefined,
  name: string,
  schema: z.ZodTypeAny,
  fallback: T,
  errors: string[],
): T => {
  if (!hasText(raw)) return fallback;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    errors.push(`${name}: invalid JSON (${e instanceof Error ? e.message.slice(0, 120) : 'parse error'})`);
    return fallback;
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    errors.push(`${name}: schema mismatch (${zodIssuesSummary(parsed.error.issues)})`);
    return fallback;
  }
  return parsed.data as T;
};

/** 条目级跨字段校验：返回该条目的诊断列表（非空即丢弃该条目）。 */
const validateEntry = (
  entry: AutoReviewProviderEntry,
  index: number,
  env: Readonly<Record<string, string | undefined>>,
): string[] => {
  const at = `AI_REVIEW_PROVIDERS_CONFIG[${index}] (id="${entry.id}")`;
  const issues: string[] = [];
  if (entry.kind === 'jev-decisions') {
    if (entry.endpoint === 'workers-ai') {
      if (!hasText(entry.accountId)) issues.push(`${at}: workers-ai requires accountId`);
      if (!resolveEntryApiKey(entry, env)) issues.push(`${at}: workers-ai requires apiKey or resolvable apiKeyEnv`);
    } else if (!isHttpUrl(entry.endpoint)) {
      issues.push(`${at}: endpoint must be an http(s) URL or "workers-ai"`);
    }
  }
  if ((entry.kind === 'omni-moderation' || entry.kind === 'nemotron') && !isHttpUrl(entry.baseUrl)) {
    issues.push(`${at}: baseUrl must be an http(s) URL`);
  }
  return issues;
};

/**
 * 读取三个环境变量：
 * - AI_REVIEW_PROVIDERS_CONFIG: 后端条目 JSON 数组
 * - AI_REVIEW_ROUTING: { strategy: 'priority' | 'weighted-random' }（默认 priority）
 * - AI_REVIEW_POLICY: { onUncertain?, exemptUserPolicy?, notifyOnAutoReject? }
 *
 * 语义约定（r1）：未配置或配置无效 ⇒ 无可用自动审查后端（providers=[]），
 * 上层不再回退旧版审查通路；所有显式配置问题记入 errors 供日志告警。
 */
export const parseAutoReviewConfig = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): ParsedAutoReviewConfig => {
  const errors: string[] = [];

  const rawProviders = parseJsonField(
    env.AI_REVIEW_PROVIDERS_CONFIG,
    'AI_REVIEW_PROVIDERS_CONFIG',
    z.array(z.unknown()),
    [] as unknown[],
    errors,
  );

  const providers: AutoReviewProviderEntry[] = [];
  const seenIds = new Set<string>();
  rawProviders.forEach((raw, index) => {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`AI_REVIEW_PROVIDERS_CONFIG[${index}]: ${zodIssuesSummary(parsed.error.issues)}`);
      return;
    }
    const entry = parsed.data;
    if (seenIds.has(entry.id)) {
      errors.push(`AI_REVIEW_PROVIDERS_CONFIG[${index}]: duplicate id "${entry.id}"`);
      return;
    }
    const issues = validateEntry(entry, index, env);
    if (issues.length > 0) {
      errors.push(...issues);
      return;
    }
    seenIds.add(entry.id);
    providers.push(entry);
  });

  const routing = parseJsonField(env.AI_REVIEW_ROUTING, 'AI_REVIEW_ROUTING', routingSchema, {
    strategy: 'priority' as const,
  }, errors);
  const policyRaw = parseJsonField<z.infer<typeof policySchema>>(
    env.AI_REVIEW_POLICY,
    'AI_REVIEW_POLICY',
    policySchema,
    {},
    errors,
  );
  const policy: AutoReviewPolicy = {
    onUncertain: (policyRaw.onUncertain as AutoReviewUncertainPolicy) ?? DEFAULT_AUTO_REVIEW_POLICY.onUncertain,
    exemptUserPolicy:
      (policyRaw.exemptUserPolicy as AutoReviewExemptPolicy) ?? DEFAULT_AUTO_REVIEW_POLICY.exemptUserPolicy,
    notifyOnAutoReject: policyRaw.notifyOnAutoReject ?? DEFAULT_AUTO_REVIEW_POLICY.notifyOnAutoReject,
  };
  return { providers, routing, policy, errors };
};

/** 条目内 apiKey 优先，其次 apiKeyEnv 指向的环境变量。 */
export const resolveEntryApiKey = (
  entry: { apiKey?: string; apiKeyEnv?: string },
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null => {
  if (hasText(entry.apiKey)) return entry.apiKey;
  if (hasText(entry.apiKeyEnv) && hasText(env[entry.apiKeyEnv])) return env[entry.apiKeyEnv]!;
  return null;
};

export type { AutoReviewBackendKind };
