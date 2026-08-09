// lib/ai/generation-settings/schemas.ts
// 用户生成参数覆盖的 zod schema，供 CustomProviderSchema 与请求体校验复用。

import { z } from 'zod/v3';
import { MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS } from '@/lib/ai/custom-provider';
import type { ThinkingEffort, UserGenerationOverrides, UserThinkingOverride } from './types';

export const THINKING_EFFORTS: ThinkingEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export const ThinkingEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

export const UserThinkingOverrideSchema: z.ZodType<UserThinkingOverride> = z.union([
  z.object({ mode: z.literal('default') }),
  z.object({ mode: z.literal('disabled') }),
  z.object({ mode: z.literal('enabled'), effort: ThinkingEffortSchema.optional() }),
]);

export const UserGenerationOverridesSchema: z.ZodType<UserGenerationOverrides> = z
  .object({
    maxOutputTokens: z.number().int().min(1).max(MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS).optional(),
    temperature: z.number().min(0).max(2).optional(),
    thinking: UserThinkingOverrideSchema.optional(),
  })
  .strict();