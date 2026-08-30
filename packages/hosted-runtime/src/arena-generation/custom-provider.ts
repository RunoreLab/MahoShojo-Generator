import { z } from 'zod/v3';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '../node-runtime/provider-catalog';

const MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS = 1_000_000;

const ThinkingSchema = z.union([
  z.object({ mode: z.literal('default') }).strict(),
  z.object({ mode: z.literal('disabled') }).strict(),
  z.object({
    mode: z.literal('enabled'),
    effort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  }).strict(),
]);

const GenerationOverridesSchema = z.object({
  maxOutputTokens: z.number().int().min(1).max(MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS).optional(),
  temperature: z.number().finite().min(0).optional(),
  thinking: ThinkingSchema.optional(),
}).strict();

export const ArenaCustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
  maxOutputTokens: z.number().int().min(1).max(MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS).optional(),
  generationOverrides: GenerationOverridesSchema.optional(),
}).strict();

export type ArenaCustomProvider = z.infer<typeof ArenaCustomProviderSchema>;

export type ResolvedArenaCustomProvider = ArenaCustomProvider & {
  provider: (typeof AI_PROVIDER_CATALOG)[number];
  modelId: string;
};

export type ArenaCustomProviderResolution =
  | { ok: true; value: ResolvedArenaCustomProvider | null }
  | { ok: false; code: string; error: string; status: number };

export const resolveArenaCustomProvider = (
  value: unknown,
): ArenaCustomProviderResolution => {
  if (value === undefined || value === null) return { ok: true, value: null };
  const parsed = ArenaCustomProviderSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'ARENA_CUSTOM_PROVIDER_INVALID',
      error: '自定义 AI 供应商配置无效',
      status: 400,
    };
  }
  const provider = AI_PROVIDER_CATALOG.find((item) => item.id === parsed.data.providerId);
  if (!provider) {
    return { ok: false, code: 'ARENA_PROVIDER_UNKNOWN', error: '未知的模型供应商 ID', status: 400 };
  }
  const model = resolveAIProviderModel(provider, parsed.data.modelId);
  if (!model) {
    return { ok: false, code: 'ARENA_MODEL_UNKNOWN', error: '未知的模型 ID', status: 400 };
  }
  if (provider.id !== 'system' && !parsed.data.apiKey.trim()) {
    return { ok: false, code: 'ARENA_PROVIDER_KEY_EMPTY', error: 'API Key 不能为空', status: 400 };
  }
  return {
    ok: true,
    value: { ...parsed.data, provider, modelId: model.modelId },
  };
};
