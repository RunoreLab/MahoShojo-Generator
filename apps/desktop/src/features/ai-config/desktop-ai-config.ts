// Desktop AI 连接配置的领域层（DESK-ONLINE-001..005）。
//
// 三个刻意的边界：
//
// - 预设连接目录只来自 `@mahoshojo/ai-core` 的 `AI_PROVIDER_PRESETS`；`system` 是服务器
//   策略展示项，永不进入客户端连接候选。
// - Direct 支持度一律经由 `describeAiPreset*DirectSupport(preset, DESKTOP_DIRECT_ADAPTERS)`
//   判定：显式核验的 wire ∩ native 已实现的 adapter。不从 `provider.type` 或端点外观推断。
// - Profile 文档仍是唯一持久化连接载体（native 侧存 opaque 文档，执行时按 profileId
//   解析）；「预设」只作为复制模板，复制出的 Profile 从那一刻起是普通自定义连接，
//   不存在「预设绑定」这种第二种身份（见 ai-core/ai-connections 的不认领约定）。

import {
  AI_PROVIDER_PRESETS,
  describeAiPresetDirectSupport,
  describeAiPresetModelDirectSupport,
  listDirectCapableAiPresetModels,
  type AIModelOption,
  type AiPresetDirectSupport,
  type AiProviderPreset,
} from '@mahoshojo/ai-core/provider-catalog';
import {
  isLoopbackHost,
  type DirectProviderAdapter,
  type DirectProviderProfileV1,
} from '@mahoshojo/contracts/provider-profile';
import {
  UserGenerationOverridesSchema,
  type UserGenerationOverrides,
} from '@mahoshojo/ai-core/generation-settings';

/**
 * 当前 Desktop native 已实现的 Direct adapter 集合。
 *
 * 这是 D5.0a 约定的宿主能力注入点：Rust 侧只有 openai-compatible 通路，因此
 * `anthropic` / `google` 的已核验 wire 也只能显示为「暂不支持的协议」。
 * native 增加 adapter 时改这一个集合即可，UI 自动跟进。
 */
export const DESKTOP_DIRECT_ADAPTERS: ReadonlySet<DirectProviderAdapter> = new Set([
  'openai-compatible',
]);

/**
 * 用户当前的 AI 执行偏好。
 *
 * 执行位置与客户端连接是**正交**的两个维度（DESK-ONLINE-001/002）：
 * 选择服务器不丢弃已选的客户端连接；连接被删除时显式解除引用或保留悬空 ID
 * 由解析层诊断，绝不自动换成另一条连接。
 */
export interface DesktopAiSelection {
  /** 执行位置偏好；'server' 在接入在线能力前是禁用占位。 */
  executionPreference: 'client' | 'server';
  /** 客户端连接选择；null = 尚未选择。 */
  clientConnectionId: string | null;
}

/** 持久化 overlay：只含非敏感偏好，secret 永远不进这份文档。 */
export interface DesktopAiConfigOverlay {
  selection: DesktopAiSelection;
  hiddenPresetIds: readonly string[];
  /** profileId → modelId → 覆盖项；嵌套结构，不做字符串复合键（id/modelId 均可含 `:`）。 */
  generationOverrides: Record<string, Record<string, UserGenerationOverrides>>;
}

export const DESKTOP_AI_CONFIG_DEFAULT_OVERLAY: DesktopAiConfigOverlay = {
  selection: { executionPreference: 'client', clientConnectionId: null },
  hiddenPresetIds: [],
  generationOverrides: {},
};

/**
 * 凭据存在性（DESK-ONLINE-004）。
 * `absent` 结合 `profile.apiKeyRef` 再区分「未配置凭据」与「凭据缺失」；
 * store 只为已查询的 profile 写入 absent/present/error，未查询到的条目由 UI 按
 * `unknown` 呈现。
 */
export type DesktopSecretPresence = 'unknown' | 'absent' | 'present' | 'error';

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isValidSelection = (value: unknown): value is DesktopAiSelection =>
  isObject(value) &&
  Object.keys(value).length === 2 &&
  (value.executionPreference === 'client' || value.executionPreference === 'server') &&
  (value.clientConnectionId === null ||
    (typeof value.clientConnectionId === 'string' && value.clientConnectionId.trim().length > 0));

/**
 * fail-closed 解析持久化 overlay。
 * 任何字段不符合形状都整体拒绝——配置文档由本客户端自己写出，损坏多半意味着
 * 被外部改过或版本不兼容；部分接受只会把静默错误带进执行路径。
 */
export const parseDesktopAiConfigOverlay = (raw: string): DesktopAiConfigOverlay => {
  const value: unknown = JSON.parse(raw);
  if (!isObject(value) || value.version !== 2) {
    throw new Error('AI 配置版本不受支持');
  }
  if (!isValidSelection(value.selection)) {
    throw new Error('AI 配置的连接选择损坏');
  }
  if (
    !Array.isArray(value.hiddenPresetIds) ||
    !value.hiddenPresetIds.every((id) => typeof id === 'string')
  ) {
    throw new Error('AI 配置的隐藏预设列表损坏');
  }
  const overrides: Record<string, Record<string, UserGenerationOverrides>> = {};
  if (value.generationOverrides !== undefined) {
    if (!isObject(value.generationOverrides)) {
      throw new Error('AI 配置的生成覆盖损坏');
    }
    for (const [profileId, modelMap] of Object.entries(value.generationOverrides)) {
      if (profileId.trim().length === 0 || !isObject(modelMap)) {
        throw new Error('AI 配置的生成覆盖损坏');
      }
      const entries: Record<string, UserGenerationOverrides> = {};
      for (const [modelId, entry] of Object.entries(modelMap)) {
        const parsed = UserGenerationOverridesSchema.safeParse(entry);
        if (!parsed.success) {
          throw new Error(`AI 配置的生成覆盖（${profileId}/${modelId}）不符合 schema`);
        }
        entries[modelId] = parsed.data;
      }
      overrides[profileId] = entries;
    }
  }
  return {
    selection: value.selection,
    hiddenPresetIds: value.hiddenPresetIds,
    generationOverrides: overrides,
  };
};

export const serializeDesktopAiConfigOverlay = (overlay: DesktopAiConfigOverlay): string =>
  JSON.stringify({ version: 2, ...overlay });

/** 预设展示行：整条支持度 + 该宿主上已核验可直连的模型清单。 */
export interface DesktopPresetEntry {
  preset: AiProviderPreset;
  hidden: boolean;
  presetSupport: AiPresetDirectSupport;
  directCapableModels: readonly AIModelOption[];
}

export const describeDesktopPresetEntry = (
  preset: AiProviderPreset,
  hidden: boolean,
): DesktopPresetEntry => ({
  preset,
  hidden,
  presetSupport: describeAiPresetDirectSupport(preset, DESKTOP_DIRECT_ADAPTERS),
  directCapableModels: listDirectCapableAiPresetModels(preset, DESKTOP_DIRECT_ADAPTERS),
});

export const listDesktopPresetEntries = (
  hiddenPresetIds: ReadonlySet<string>,
): readonly DesktopPresetEntry[] =>
  AI_PROVIDER_PRESETS.map((preset) => describeDesktopPresetEntry(preset, hiddenPresetIds.has(preset.id)));

/** 判定单个 (preset, modelId) 的 Direct 支持度（编辑器内逐模型展示用）。 */
export const describeDesktopPresetModelSupport = (
  preset: AiProviderPreset,
  modelId: string,
): AiPresetDirectSupport =>
  describeAiPresetModelDirectSupport(preset, modelId, DESKTOP_DIRECT_ADAPTERS);

/** 一次客户端执行目标的完整解析。设置页与生成入口都必须消费同一份结果。 */
export interface ResolvedDesktopAiTarget {
  /** 'server' = 服务器策略；'client' = 某个已保存连接。 */
  location: 'client' | 'server';
  profile: DirectProviderProfileV1 | null;
  /** 客户端连接的执行模式；server/不可用时为 null。 */
  mode: 'direct-local' | 'direct-remote' | null;
  modelId: string | null;
  generationOverrides: UserGenerationOverrides | undefined;
  /** 当前不可执行时的用户可读原因；null 表示可以执行。 */
  unavailableReason: string | null;
}

export const resolveDesktopAiTarget = (
  selection: DesktopAiSelection,
  profiles: readonly DirectProviderProfileV1[],
  generationOverrides: Readonly<Record<string, Readonly<Record<string, UserGenerationOverrides>>>>,
): ResolvedDesktopAiTarget => {
  if (selection.executionPreference === 'server') {
    return {
      location: 'server',
      profile: null,
      mode: null,
      modelId: null,
      generationOverrides: undefined,
      // 诚实标注：服务器执行需要项目在线能力，Desktop 尚未接入。
      unavailableReason: '服务器执行将在接入在线能力后开放',
    };
  }

  if (selection.clientConnectionId === null) {
    return {
      location: 'client',
      profile: null,
      mode: null,
      modelId: null,
      generationOverrides: undefined,
      // 新安装默认客户端但未选连接：引导配置，而不是静默切服务器。
      unavailableReason: '尚未选择客户端连接：请新增、复制预设或选择一条已有连接',
    };
  }

  const profile = profiles.find((item) => item.id === selection.clientConnectionId) ?? null;
  if (!profile) {
    return {
      location: 'client',
      profile: null,
      mode: null,
      modelId: null,
      generationOverrides: undefined,
      unavailableReason: '所选连接已不存在，请在设置中重新选择或新建连接',
    };
  }

  if (!DESKTOP_DIRECT_ADAPTERS.has(profile.adapter)) {
    return {
      location: 'client',
      profile,
      mode: null,
      modelId: profile.modelId,
      generationOverrides: undefined,
      unavailableReason: `当前客户端尚未实现 ${profile.adapter} 适配器，请改用 OpenAI-compatible 连接`,
    };
  }

  let mode: 'direct-local' | 'direct-remote' = 'direct-remote';
  try {
    mode = isLoopbackHost(new URL(profile.baseUrl).hostname) ? 'direct-local' : 'direct-remote';
  } catch {
    // baseUrl 已过了 Profile schema 校验；防御性回退到远端语义。
  }

  return {
    location: 'client',
    profile,
    mode,
    modelId: profile.modelId,
    generationOverrides: generationOverrides[profile.id]?.[profile.modelId],
    unavailableReason: null,
  };
};
