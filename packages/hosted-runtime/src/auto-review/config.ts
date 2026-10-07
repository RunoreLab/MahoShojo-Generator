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
  .passthrough();

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
  options: z.object({ customPolicy: z.string().optional() }).passthrough().optional(),
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
});

const policySchema = z.object({
  onUncertain: z.enum(['normal', 'hold', 'approve', 'reject']).optional(),
  exemptUserPolicy: z.enum(['skip', 'review']).optional(),
  notifyOnAutoReject: z.boolean().optional(),
});

export type ParsedAutoReviewConfig = {
  providers: AutoReviewProviderEntry[];
  routing: AutoReviewRouting;
  policy: AutoReviewPolicy;
};

const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const parseJson = <T>(raw: string | undefined, schema: z.ZodTypeAny, fallback: T): T => {
  if (!hasText(raw)) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as T) : fallback;
  } catch {
    return fallback;
  }
};

/**
 * 读取三个环境变量：
 * - AI_REVIEW_PROVIDERS_CONFIG: 后端条目 JSON 数组
 * - AI_REVIEW_ROUTING: { strategy: 'priority' | 'weighted-random' }（默认 priority）
 * - AI_REVIEW_POLICY: { onUncertain?, exemptUserPolicy?, notifyOnAutoReject? }
 */
export const parseAutoReviewConfig = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): ParsedAutoReviewConfig => {
  const providers = parseJson(env.AI_REVIEW_PROVIDERS_CONFIG, z.array(entrySchema), []);
  const routing = parseJson(env.AI_REVIEW_ROUTING, routingSchema, { strategy: 'priority' as const });
  const policyRaw = parseJson<z.infer<typeof policySchema>>(env.AI_REVIEW_POLICY, policySchema, {});
  const policy: AutoReviewPolicy = {
    onUncertain: (policyRaw.onUncertain as AutoReviewUncertainPolicy) ?? DEFAULT_AUTO_REVIEW_POLICY.onUncertain,
    exemptUserPolicy:
      (policyRaw.exemptUserPolicy as AutoReviewExemptPolicy) ?? DEFAULT_AUTO_REVIEW_POLICY.exemptUserPolicy,
    notifyOnAutoReject: policyRaw.notifyOnAutoReject ?? DEFAULT_AUTO_REVIEW_POLICY.notifyOnAutoReject,
  };
  return { providers, routing, policy };
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
