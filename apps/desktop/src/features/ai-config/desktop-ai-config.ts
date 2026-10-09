// Desktop AI 连接配置的领域层（DESK-ONLINE-001..005）。
//
// 三个刻意的边界：
//
// - 预设连接目录只来自 `@mahoshojo/ai-core` 的 `AI_PROVIDER_PRESETS`；`system` 是服务器
//   策略展示项，永不进入客户端连接候选。
// - Direct 支持度一律经由 `describeAiPreset*DirectSupport(preset, DESKTOP_DIRECT_ADAPTERS)`
//   判定：显式核验的 wire ∩ native 已实现的 adapter。不从 `provider.type` 或端点外观推断。
// - 预设由稳定 providerId 绑定安全存储；只有用户主动新建/复制才产生 Profile。
//   两种身份按执行位置独立选择，native 从受检目录或既有 Profile 解析真实目标。

import { ProviderModelIdSchema, type ProviderTarget } from '@mahoshojo/contracts/provider-target';
import {
  AI_PROVIDER_PRESETS,
  SYSTEM_PROVIDER_OPTION,
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
 * 简化连接编辑器能表达的 adapter 集合——**独立于** `DESKTOP_DIRECT_ADAPTERS`。
 * 「native 能执行什么」与「编辑器能编辑什么」是两件事：native 将来新增 adapter 后
 * 不能让旧 Profile 自动变成可编辑（编辑器会静默改写 adapter 字段）。
 */
export const DESKTOP_EDITABLE_PROFILE_ADAPTERS: ReadonlySet<DirectProviderAdapter> = new Set([
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
  /** 执行位置偏好；'server' 走 hosted System Default（不要求登录，DESK-094 在 dispatch 时校验）。 */
  executionPreference: 'client' | 'server';
  /** 客户端连接选择；null = 尚未选择。 */
  /** 旧调用方的派生投影；v5 不再持久化或以此作为预设身份。 */
  clientConnectionId: string | null;
  clientTarget?: Exclude<ProviderTarget, { kind: 'system' }> | null;
  serverTarget?: Exclude<ProviderTarget, { kind: 'custom' }>;
  /**
   * 「使用系统默认配置」通道的模型选择（overlay v4 起）。
   * 取值为 `SYSTEM_PROVIDER_OPTION.models` 中的模型 ID（`'default'` 表示服务器
   * 默认顺序）；缺省等同 `'default'`。与 Web `providerId:'system' + modelId`
   * 语义一致，非秘密偏好，不含凭据。
   */
  systemModelId?: string;
}

/**
 * 单个连接的模型选择状态（DESK-AIP-006）。
 * `profile.modelId` 是默认模型；本结构只承载「当前选择 + 自定义补充模型」，
 * 不复制、不改写 Profile 自身字段。
 */
export interface DesktopProfileModelSelection {
  /**
   * 显式选中的模型；缺省时生效模型跟随 `profile.modelId`。
   * 显式值之后若因删除/Profile 编辑而不再可用，解析层提示重新选择，
   * 不做静默回落。
   */
  selectedModelId?: string;
  /** 当前手填模型，直接执行；输入中间值不登记进模型列表。 */
  inlineModelId?: string;
  /** 该连接附加的可选模型 ID（去重、保持添加顺序）。 */
  customModelIds: readonly string[];
}

const DESKTOP_MODEL_ID_MAX_LENGTH = 256;
const DANGEROUS_MODEL_ID_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;

/**
 * servedModelId 边界（DESK-AIP-005）：与 Profile 默认模型同口径
 * （`nonBlankString(256)`：trim 后非空、≤256 字符），另拒 C0/C1/DEL
 * 危险控制字符——模型 ID 会直接进入 wire 请求与 overlay 持久化键。
 */
export const isValidDesktopModelId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= DESKTOP_MODEL_ID_MAX_LENGTH &&
  !DANGEROUS_MODEL_ID_CHAR_PATTERN.test(value);

/**
 * `generationOverrides` 中为「使用系统默认配置」通道保留的 scope key。
 * 与 Web `arena.customProvider.generationOverrides.system.<modelId>` 语义一致。
 * 该值同时被保留为 Profile ID 命名禁区——一个名叫 `system` 的连接会与
 * 系统通道的覆盖作用域撞名，store 在保存时拒绝（`modelsByProfileId` 只按
 * Profile ID 索引，不用于系统通道）。
 */
export const DESKTOP_SYSTEM_OVERRIDES_SCOPE = 'system';

/** 「使用系统默认配置」当前可选的系统模型清单（与目录单一事实源同序）。 */
export const listDesktopSystemModelOptions = (): readonly AIModelOption[] =>
  SYSTEM_PROVIDER_OPTION.models;

/** 判定一个模型 ID 是否仍在系统默认配置的公开清单内。 */
export const isDesktopSystemModelId = (modelId: string): boolean =>
  SYSTEM_PROVIDER_OPTION.models.some((model) => model.value === modelId);

/** 持久化 overlay：只含非敏感偏好，secret 永远不进这份文档。 */
export interface DesktopAiConfigOverlay {
  selection: DesktopAiSelection;
  hiddenPresetIds: readonly string[];
  /** profileId → modelId → 覆盖项；嵌套结构，不做字符串复合键（id/modelId 均可含 `:`）。 */
  generationOverrides: Record<string, Record<string, UserGenerationOverrides>>;
  /** profileId → 该连接的模型选择/自定义模型清单（overlay v3 起持久化）。 */
  modelsByProfileId: Record<string, DesktopProfileModelSelection>;
  presetsByProviderId?: Record<string, DesktopPresetSelection>;
}

export interface DesktopPresetSelection {
  selectedModelId?: string;
  generationOverrides: Record<string, UserGenerationOverrides>;
}

export const selectedProviderTarget = (selection: DesktopAiSelection): ProviderTarget | null =>
  selection.executionPreference === 'server'
    ? (selection.serverTarget ?? { kind: 'system' })
    : selection.clientTarget !== undefined
      ? selection.clientTarget
      : selection.clientConnectionId ? { kind: 'custom', profileId: selection.clientConnectionId } : null;

export const DESKTOP_AI_CONFIG_DEFAULT_OVERLAY: DesktopAiConfigOverlay = {
  selection: { executionPreference: 'client', clientConnectionId: null, clientTarget: null, serverTarget: { kind: 'system' } },
  hiddenPresetIds: [],
  generationOverrides: {},
  modelsByProfileId: {},
  presetsByProviderId: {},
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

const DESKTOP_SELECTION_KEYS = new Set([
  'executionPreference',
  'clientConnectionId',
  'systemModelId',
  'clientTarget',
  'serverTarget',
]);

const isValidSelection = (value: unknown): value is DesktopAiSelection =>
  isObject(value) &&
  Object.keys(value).every((key) => DESKTOP_SELECTION_KEYS.has(key)) &&
  (value.executionPreference === 'client' || value.executionPreference === 'server') &&
  (value.clientConnectionId === undefined || value.clientConnectionId === null ||
    (typeof value.clientConnectionId === 'string' && value.clientConnectionId.trim().length > 0)) &&
  (value.systemModelId === undefined || isValidDesktopModelId(value.systemModelId));

/**
 * fail-closed 解析持久化 overlay。
 * 任何字段不符合形状都整体拒绝——配置文档由本客户端自己写出，损坏多半意味着
 * 被外部改过或版本不兼容；部分接受只会把静默错误带进执行路径。
 */
export const parseDesktopAiConfigOverlay = (raw: string): DesktopAiConfigOverlay => {
  const value: unknown = JSON.parse(raw);
  // v2 → v4 迁移：v2 缺省 `modelsByProfileId`，v3 缺省 `selection.systemModelId`；
  // 解析后各自初始化为空，下一次落盘即以 v4 写回（受检、幂等——只在整体解析
  // 成功后写）。未知版本继续 fail-closed。
  if (!isObject(value) || (value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5)) {
    throw new Error('AI 配置版本不受支持');
  }
  if (!isValidSelection(value.selection) ||
      (value.version !== 5 && value.selection.clientConnectionId === undefined) ||
      (value.version === 5 && (value.selection.clientTarget === undefined || value.selection.serverTarget === undefined))) {
    throw new Error('AI 配置的连接选择损坏');
  }
  if (
    !Array.isArray(value.hiddenPresetIds) ||
    !value.hiddenPresetIds.every((id) => typeof id === 'string')
  ) {
    throw new Error('AI 配置的隐藏预设列表损坏');
  }
  // 字典一律 null-prototype：profileId/modelId 都可能合法地是 "__proto__"
  // 这类标识符，普通对象上的 `record[key] = value` 会走原型 setter 造成污染或
  // 静默丢数据。仓库的 GenerationDefaultKeySchema 已采用同一防动态键原则。
  const overrides: Record<string, Record<string, UserGenerationOverrides>> =
    Object.create(null) as Record<string, Record<string, UserGenerationOverrides>>;
  if (value.generationOverrides !== undefined) {
    if (!isObject(value.generationOverrides)) {
      throw new Error('AI 配置的生成覆盖损坏');
    }
    for (const [profileId, modelMap] of Object.entries(value.generationOverrides)) {
      if (profileId.trim().length === 0 || !isObject(modelMap)) {
        throw new Error('AI 配置的生成覆盖损坏');
      }
      const entries = Object.create(null) as Record<string, UserGenerationOverrides>;
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
  const modelsByProfileId: Record<string, DesktopProfileModelSelection> =
    Object.create(null) as Record<string, DesktopProfileModelSelection>;
  if (value.modelsByProfileId !== undefined) {
    if (!isObject(value.modelsByProfileId)) {
      throw new Error('AI 配置的模型选择损坏');
    }
    for (const [profileId, entry] of Object.entries(value.modelsByProfileId)) {
      const keys = isObject(entry) ? Object.keys(entry) : [];
      if (
        profileId.trim().length === 0 ||
        !isObject(entry) ||
        !keys.every((key) => key === 'selectedModelId' || key === 'customModelIds' || key === 'inlineModelId') ||
        (entry.selectedModelId !== undefined && !isValidDesktopModelId(entry.selectedModelId)) ||
        (entry.inlineModelId !== undefined && !ProviderModelIdSchema.safeParse(entry.inlineModelId).success) ||
        !Array.isArray(entry.customModelIds) ||
        !entry.customModelIds.every((id) => isValidDesktopModelId(id))
      ) {
        throw new Error('AI 配置的模型选择损坏');
      }
      // trim 归一：与 schema 的 `.trim()` 语义一致，保证 selectedModelId 与
      // customModelIds 之间的相等性不受持久化空白影响。
      modelsByProfileId[profileId] = {
        ...(entry.inlineModelId === undefined ? {} : { inlineModelId: (entry.inlineModelId as string).trim() }),
        ...(entry.selectedModelId === undefined
          ? {}
          : { selectedModelId: (entry.selectedModelId as string).trim() }),
        customModelIds: entry.customModelIds.map((id) => (id as string).trim()),
      };
    }
  }
  const selection = value.selection;
  const clientTarget = selection.clientTarget !== undefined ? selection.clientTarget : (selection.clientConnectionId ? { kind: 'custom' as const, profileId: selection.clientConnectionId } : null);
  const serverTarget = selection.serverTarget ?? { kind: 'system' as const };
  const validTarget = (target: unknown, location: 'client' | 'server'): boolean => {
    if (target === null) return location === 'client';
    if (!isObject(target)) return false;
    const id = target.kind === 'preset' ? target.providerId : target.profileId;
    return target.kind === 'system'
      ? location === 'server' && Object.keys(target).length === 1
      : (target.kind === 'preset' || (location === 'client' && target.kind === 'custom')) &&
        typeof id === 'string' && id.trim().length > 0 && Object.keys(target).length === 2;
  };
  if (!validTarget(clientTarget, 'client') || !validTarget(serverTarget, 'server')) throw new Error('AI 配置目标损坏');
  const presetsByProviderId = Object.create(null) as Record<string, DesktopPresetSelection>;
  if (value.presetsByProviderId !== undefined) {
    if (!isObject(value.presetsByProviderId)) throw new Error('AI 预设配置损坏');
    for (const [id, entry] of Object.entries(value.presetsByProviderId)) {
      if (!id.trim() || !isObject(entry) || !isObject(entry.generationOverrides) ||
          Object.keys(entry).some((key) => key !== 'selectedModelId' && key !== 'generationOverrides') ||
          (entry.selectedModelId !== undefined && !ProviderModelIdSchema.safeParse(entry.selectedModelId).success)) throw new Error('AI 预设配置损坏');
      const overrides = Object.create(null) as Record<string, UserGenerationOverrides>;
      for (const [model, override] of Object.entries(entry.generationOverrides)) overrides[model] = UserGenerationOverridesSchema.parse(override);
      presetsByProviderId[id] = { ...(entry.selectedModelId === undefined ? {} : { selectedModelId: (entry.selectedModelId as string).trim() }), generationOverrides: overrides };
    }
  }
  return {
    selection: { ...selection, clientTarget, serverTarget, clientConnectionId: clientTarget?.kind === 'custom' ? clientTarget.profileId : null },
    presetsByProviderId,
    hiddenPresetIds: value.hiddenPresetIds,
    generationOverrides: overrides,
    modelsByProfileId,
  };
};

export const serializeDesktopAiConfigOverlay = (overlay: DesktopAiConfigOverlay): string =>
  JSON.stringify({ version: 5, ...overlay, selection: { ...overlay.selection, clientConnectionId: undefined, clientTarget: overlay.selection.clientTarget !== undefined ? overlay.selection.clientTarget : overlay.selection.clientConnectionId ? { kind: 'custom', profileId: overlay.selection.clientConnectionId } : null, serverTarget: overlay.selection.serverTarget ?? { kind: 'system' } } });

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
  providerTarget?: ProviderTarget;
  preset?: AiProviderPreset;
  profile: DirectProviderProfileV1 | null;
  /** 客户端连接的执行模式；server/不可用时为 null。 */
  mode: 'direct-local' | 'direct-remote' | null;
  /** 生效模型：`selectedModelId ?? profile.modelId`（悬空选择时保留原值供诊断）。 */
  modelId: string | null;
  /** 当前连接的候选模型清单：默认模型 + 自定义模型去重；非客户端目标为空。 */
  availableModelIds: readonly string[];
  generationOverrides: UserGenerationOverrides | undefined;
  /** 当前不可执行时的用户可读原因；null 表示可以执行。 */
  unavailableReason: string | null;
}

const ownEntry = <T,>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record && Object.hasOwn(record, key) ? record[key] : undefined;

export const resolveDesktopAiTarget = (
  selection: DesktopAiSelection,
  profiles: readonly DirectProviderProfileV1[],
  generationOverrides: Readonly<Record<string, Readonly<Record<string, UserGenerationOverrides>>>>,
  modelsByProfileId: Readonly<Record<string, DesktopProfileModelSelection>>,
  presetsByProviderId: Readonly<Record<string, DesktopPresetSelection>> = {},
): ResolvedDesktopAiTarget => {
  const providerTarget = selectedProviderTarget(selection);
  if (providerTarget?.kind === 'preset') {
    const preset = AI_PROVIDER_PRESETS.find((entry) => entry.id === providerTarget.providerId);
    const preference = ownEntry(presetsByProviderId, providerTarget.providerId);
    const models = preset ? (selection.executionPreference === 'client' ? listDirectCapableAiPresetModels(preset, DESKTOP_DIRECT_ADAPTERS) : preset.models) : [];
    const modelId = preference?.selectedModelId ?? models[0]?.value ?? null;
    const support = preset && modelId ? describeDesktopPresetModelSupport(preset, modelId) : null;
    return {
      location: selection.executionPreference, providerTarget, preset, profile: null,
      mode: selection.executionPreference === 'client' && support?.supported ? 'direct-remote' : null,
      modelId, availableModelIds: [...new Set([...models.map((model) => model.value), ...(modelId ? [modelId] : [])])],
      generationOverrides: modelId ? ownEntry(preference?.generationOverrides, modelId) : undefined,
      unavailableReason: !preset ? '供应商已不在项目目录中，请重新选择' : !modelId ? '请选择模型' : selection.executionPreference === 'client' && !support?.supported ? '该模型的直连协议尚未核验，请选择受支持的模型或切换服务器执行' : null,
    };
  }
  if (selection.executionPreference === 'server') {
    // 「使用系统默认配置」通道：模型清单来自 SYSTEM_PROVIDER_OPTION（与 Web
    // 同一目录事实源）；未选择时生效模型为 'default'（服务器默认顺序）。
    // 显式选择过、后被目录移除的模型保留原值供诊断并要求重新选择——
    // 不静默回落默认模型，也不允许拿悬空 ID 去执行。
    const systemModelIds = SYSTEM_PROVIDER_OPTION.models.map((model) => model.value);
    const storedSystemModelId = selection.systemModelId;
    const systemModelDangling =
      storedSystemModelId !== undefined && !systemModelIds.includes(storedSystemModelId);
    const effectiveSystemModelId = storedSystemModelId ?? 'default';
    return {
      location: 'server',
      providerTarget: { kind: 'system' },
      profile: null,
      mode: null,
      modelId: effectiveSystemModelId,
      availableModelIds: systemModelIds,
      generationOverrides:
        ownEntry(ownEntry(generationOverrides, DESKTOP_SYSTEM_OVERRIDES_SCOPE), effectiveSystemModelId),
      // hosted 通路已接入：可执行性由 dispatch 时 DESK-094 兼容/可达性门禁裁决，
      // 登录与否只影响会话 cookie 是否附带，不是前置条件。
      unavailableReason: systemModelDangling
        ? '所选系统模型已不在支持列表中，请重新选择'
        : null,
    };
  }

  const profileId = providerTarget?.kind === 'custom' ? providerTarget.profileId : null;
  if (profileId === null) {
    return {
      location: 'client',
      profile: null,
      mode: null,
      modelId: null,
      availableModelIds: [],
      generationOverrides: undefined,
      // 新安装默认客户端但未选连接：引导配置，而不是静默切服务器。
      unavailableReason: '请选择内置供应商或自定义连接',
    };
  }

  const profile = profiles.find((item) => item.id === profileId) ?? null;
  if (!profile) {
    return {
      location: 'client',
      profile: null,
      mode: null,
      modelId: null,
      availableModelIds: [],
      generationOverrides: undefined,
      unavailableReason: '所选连接已不存在，请在设置中重新选择或新建连接',
    };
  }

  // 生效模型（DESK-AIP-005/006）：清单 = 默认模型 + 自定义模型去重；
  // 显式 selectedModelId 优先，缺省时跟随 profile.modelId。
  const modelSelection = ownEntry(modelsByProfileId, profile.id);
  const availableModelIds = [
    ...new Set([profile.modelId, ...(modelSelection?.customModelIds ?? []), ...(modelSelection?.inlineModelId ? [modelSelection.inlineModelId] : [])]),
  ];
  const effectiveModelId = modelSelection?.inlineModelId ?? modelSelection?.selectedModelId ?? profile.modelId;

  if (!DESKTOP_DIRECT_ADAPTERS.has(profile.adapter)) {
    return {
      location: 'client',
      profile,
      mode: null,
      modelId: effectiveModelId,
      availableModelIds,
      generationOverrides: undefined,
      unavailableReason: `当前客户端尚未实现 ${profile.adapter} 适配器，请改用 OpenAI-compatible 连接`,
    };
  }

  // 显式选择过的模型被删除或随 Profile 编辑失效：fail-closed 要求重新选择，
  // 不静默回落默认模型，也不允许拿悬空 ID 去执行。
  if (!availableModelIds.includes(effectiveModelId)) {
    return {
      location: 'client',
      profile,
      mode: null,
      modelId: effectiveModelId,
      availableModelIds,
      generationOverrides: ownEntry(ownEntry(generationOverrides, profile.id), effectiveModelId),
      unavailableReason: '所选模型已不在连接模型列表中，请重新选择模型',
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
    providerTarget: { kind: 'custom', profileId: profile.id },
    profile,
    mode,
    modelId: effectiveModelId,
    availableModelIds,
    generationOverrides: ownEntry(ownEntry(generationOverrides, profile.id), effectiveModelId),
    unavailableReason: null,
  };
};
