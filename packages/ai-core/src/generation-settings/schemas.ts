// 用户生成参数覆盖的 zod schema，供 CustomProviderSchema、选择器持久化与请求体校验复用。
//
// 刻意使用 `zod/v3`：Web API 处理函数把本 schema 直接组合进 `zod/v3` 的 `z.object`，
// 两个版本家族的 schema 不能互相嵌套。这里与 `@mahoshojo/contracts` 的 zod4 共存是
// 刻意的——本 schema 是客户端持久化/请求输入形状，不是桌面 IPC wire 契约。

import { z } from 'zod/v3';

import type { ThinkingEffort, UserGenerationOverrides, UserThinkingOverride } from './types';
import { MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS } from './user-ai-config';

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
    // 上限不在此硬编码：已知模型由 Capability Registry 决定，未知自定义模型按“开放透传”处理。
    temperature: z.number().finite().min(0).optional(),
    thinking: UserThinkingOverrideSchema.optional(),
  })
  .strict();
