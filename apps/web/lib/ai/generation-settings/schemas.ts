// lib/ai/generation-settings/schemas.ts
// 用户生成参数覆盖的 zod schema 兼容出口。
// 权威定义已上移到 `@mahoshojo/ai-core/generation-settings`（D5.0b：Web 选择器与
// Desktop 设置页共用同一份 schema）；本文件只保留旧导入路径可用。
//
// 注意：上游 schema 刻意用 `zod/v3` 实现，本文件可以继续被组合进 `zod/v3` 的
// `z.object`（两个 zod 版本家族的 schema 不能互相嵌套）。

export {
  THINKING_EFFORTS,
  ThinkingEffortSchema,
  UserGenerationOverridesSchema,
  UserThinkingOverrideSchema,
} from '@mahoshojo/ai-core/generation-settings';
