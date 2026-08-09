// lib/ai/generation-settings/types.ts
// 用户生成参数覆盖、模型能力与最终解析结果的共享类型定义。

/**
 * 推理强度档位。各 Provider 的术语不同（reasoning_effort / thinkingLevel / effort），
 * 这里使用统一语义，由 adapter 在边界转换。
 */
export type ThinkingEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * 用户对推理 / Thinking 的覆盖意图。
 * - default：跟随模型默认；
 * - disabled：显式关闭；
 * - enabled：显式开启，可选强度档位。
 */
export type UserThinkingOverride =
  | { mode: 'default' }
  | { mode: 'disabled' }
  | { mode: 'enabled'; effort?: ThinkingEffort };

/**
 * 用户希望在“生成时如何调用模型”的覆盖项。
 * 只表达意图，是否真正发送由模型能力层（Resolver）决定。
 */
export interface UserGenerationOverrides {
  /** 最大输出 Tokens */
  maxOutputTokens?: number;
  /** 温度 */
  temperature?: number;
  /** 推理 / Thinking 设置 */
  thinking?: UserThinkingOverride;
}

/** 某参数的支持状态。unsupported 则不发送；unknown 则开放尝试发送。 */
export type SupportState = 'supported' | 'unsupported' | 'unknown';

/**
 * 推理适配器类型，决定档位/开关如何映射到最终请求参数。
 * 按“控制机制”区分，避免 Gemini 2.5（thinkingBudget）与 Gemini 3.x（thinkingLevel）
 * 等代际协议混用。
 */
export type ThinkingAdapter =
  | 'google-thinking-budget'
  | 'google-thinking-level'
  | 'google-thinking-binary-level'
  | 'openai-reasoning-effort'
  | 'deepseek-thinking-toggle'
  | 'unknown';

/** 单个模型在某 Provider 下支持的生成能力。 */
export interface ModelGenerationCapabilities {
  temperature: {
    support: SupportState;
    min?: number;
    max?: number;
  };
  maxOutputTokens: {
    support: SupportState;
    max?: number;
  };
  thinking: {
    support: SupportState;
    efforts?: ThinkingEffort[];
    adapter?: ThinkingAdapter;
    /** 是否允许显式关闭 Thinking；省略表示未知/由调用方保守处理。 */
    canDisable?: boolean;
  };
}

/** 某一生成任务的默认参数（来自任务调用点）。 */
export interface GenerationTaskDefaults {
  temperature?: number;
  maxOutputTokens?: number;
}

/** 某一 Provider 的默认参数（如 defaultMaxOutputTokens）。 */
export type GenerationProviderDefaults = {
  defaultMaxOutputTokens?: number;
};

/** 生成设置调用上下文：在 system / custom 两条通道统一传递 providerId 与用户覆盖。 */
export interface GenerationSettingsContext {
  providerId?: string;
  userOverrides?: UserGenerationOverrides;
}

/** 被丢弃 / 未发送的字段说明，供 UI 与日志解释。 */
export interface OmittedField {
  field: string;
  reason: string;
}

/** JSON 值（与 AI SDK ProviderOptions 兼容）。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** 发送给 AI SDK 的 providerOptions 形态：`{ providerId: { field: value } }`。 */
export type GenerationProviderOptions = Record<string, Record<string, JsonValue>>;

/** 最终 Resolver 输出。 */
export interface ResolvedGenerationSettings {
  /** 发送给 AI SDK 的标准参数（仅含应发送的字段）。 */
  standardOptions: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  /** Provider 专属参数（如 google.thinkingConfig、openai.reasoningEffort）。 */
  providerOptions?: GenerationProviderOptions;
  /** 诊断信息。 */
  diagnostics: {
    omitted: OmittedField[];
    warnings: string[];
  };
}