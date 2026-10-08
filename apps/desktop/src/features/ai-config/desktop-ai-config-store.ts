// Desktop AI 配置的单一事实源（overlay store）。
//
// 两类状态合成一份快照：
// - overlay：用户偏好（当前选择 / 隐藏预设 / 生成覆盖），同步持久化到注入的 KV
//   端口（Desktop 上是 localStorage，只含非敏感数据，secret 永不进入）；
// - profiles：native 存储的 `DirectProviderProfileV1` 集合 + 各自的凭据存在性，
//   经既有 bridge 异步加载。
//
// 设置页与生成入口共享同一个 store 实例（见 `use-desktop-ai-config.ts` 的
// 模块级单例），两处消费的就是同一份 `resolveDesktopAiTarget` 结果——不允许
// 再长出一套平行的「详情页自己选 Profile」状态。

import type { DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';
import type { UserGenerationOverrides } from '@mahoshojo/ai-core/generation-settings';

import {
  deleteProviderProfile,
  getProviderProfile,
  listProviderProfileIds,
  saveProviderProfile,
  validateProviderExecutionProfile,
} from '../../platform/provider-profile-bridge';
import {
  deleteProviderSecret,
  hasProviderSecret,
  setProviderSecret,
} from '../../platform/secret-bridge';
import {
  ProfileDraftError,
  buildProfile,
  type ProfileDraft,
} from '../providers/profile-draft';

import {
  DESKTOP_AI_CONFIG_DEFAULT_OVERLAY,
  DESKTOP_EDITABLE_PROFILE_ADAPTERS,
  isValidDesktopModelId,
  parseDesktopAiConfigOverlay,
  serializeDesktopAiConfigOverlay,
  type DesktopAiConfigOverlay,
  type DesktopAiSelection,
  type DesktopProfileModelSelection,
  type DesktopSecretPresence,
} from './desktop-ai-config';

export const DESKTOP_AI_CONFIG_STORAGE_KEY = 'mahoshojo.desktop.ai-config.v1';
const MAX_OVERLAY_CHARACTERS = 256 * 1024;

/** 与平台桥一致的 invoke 形状。 */
export type DesktopAiConfigInvokeFn = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export interface DesktopAiConfigKvStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DesktopAiConfigDeps {
  storage: DesktopAiConfigKvStorage;
  invoke: DesktopAiConfigInvokeFn;
  now?: () => string;
}

export type DesktopAiConfigOverlayState = 'loading' | 'ready' | 'blocked';
export type DesktopAiProfilesState = 'idle' | 'loading' | 'ready' | 'failed';

export interface DesktopAiConfigState {
  overlayState: DesktopAiConfigOverlayState;
  /** overlay 损坏时的可读原因；blocked 期间拒绝一切写入，直到显式重置。 */
  overlayError: string | null;
  selection: DesktopAiSelection;
  hiddenPresetIds: ReadonlySet<string>;
  generationOverrides: Readonly<Record<string, Readonly<Record<string, UserGenerationOverrides>>>>;
  /** profileId → 模型选择/自定义清单（DESK-AIP-006）；值不可变。 */
  modelsByProfileId: Readonly<Record<string, DesktopProfileModelSelection>>;
  profiles: readonly DirectProviderProfileV1[];
  profilesState: DesktopAiProfilesState;
  profilesError: string | null;
  /** profileId → 凭据存在性；只回答存在性，永不读回明文。 */
  secretStatus: Readonly<Record<string, DesktopSecretPresence>>;
  savingConnection: boolean;
}

const INITIAL_STATE: DesktopAiConfigState = {
  overlayState: 'loading',
  overlayError: null,
  selection: DESKTOP_AI_CONFIG_DEFAULT_OVERLAY.selection,
  hiddenPresetIds: new Set(),
  generationOverrides: {},
  modelsByProfileId: {},
  profiles: [],
  profilesState: 'idle',
  profilesError: null,
  secretStatus: {},
  savingConnection: false,
};

export class DesktopAiConfigStore {
  private state: DesktopAiConfigState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private overlay: DesktopAiConfigOverlay = DESKTOP_AI_CONFIG_DEFAULT_OVERLAY;
  private initialized = false;
  private profilesPromise: Promise<void> | null = null;

  constructor(private readonly deps: DesktopAiConfigDeps) {}

  getSnapshot = (): DesktopAiConfigState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(patch: Partial<DesktopAiConfigState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private publishOverlay(): void {
    this.publish({
      selection: this.overlay.selection,
      hiddenPresetIds: new Set(this.overlay.hiddenPresetIds),
      // 字典保持 null-prototype：profileId/modelId 可能是 "__proto__" 这类合法
      // 标识符，普通对象消费它们时会碰到原型语义。
      generationOverrides: Object.assign(
        Object.create(null) as Record<string, Record<string, UserGenerationOverrides>>,
        this.overlay.generationOverrides,
      ),
      modelsByProfileId: Object.assign(
        Object.create(null) as Record<string, DesktopProfileModelSelection>,
        this.overlay.modelsByProfileId,
      ),
    });
  }

  private get overlayWritable(): boolean {
    return this.state.overlayState === 'ready';
  }

  /** overlay 落盘；blocked 状态拒绝写入，避免覆盖一份自己读不懂的数据。 */
  private persistOverlay(): void {
    if (this.state.overlayState === 'blocked') return;
    const raw = serializeDesktopAiConfigOverlay(this.overlay);
    if (raw.length > MAX_OVERLAY_CHARACTERS) {
      throw new Error('AI 配置超过大小限制，未写入');
    }
    this.deps.storage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, raw);
  }

  /** 幂等初始化：overlay 同步读取，profiles 异步加载。 */
  init = (): void => {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const raw = this.deps.storage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY);
      if (raw !== null) {
        this.overlay = parseDesktopAiConfigOverlay(raw);
      }
      this.state = { ...this.state, overlayState: 'ready' };
      this.publishOverlay();
    } catch (cause) {
      this.publish({
        overlayState: 'blocked',
        overlayError:
          cause instanceof Error ? cause.message : 'AI 配置无法解析，已阻止写入以保护原数据',
      });
      return;
    }

    void this.refreshProfiles();
  };

  /** 损坏 overlay 的显式逃生门：清空后回到默认并允许重新写入。 */
  resetBlockedOverlay = (): void => {
    if (this.state.overlayState !== 'blocked') return;
    this.deps.storage.removeItem(DESKTOP_AI_CONFIG_STORAGE_KEY);
    this.overlay = DESKTOP_AI_CONFIG_DEFAULT_OVERLAY;
    this.state = { ...this.state, overlayState: 'ready', overlayError: null };
    this.publishOverlay();
    void this.refreshProfiles();
  };

  refreshProfiles = async (): Promise<void> => {
    if (this.profilesPromise) return this.profilesPromise;
    this.publish({ profilesState: 'loading', profilesError: null });
    this.profilesPromise = (async () => {
      try {
        const ids = await listProviderProfileIds(this.deps.invoke);
        const loaded = await Promise.all(
          ids.map((id) => getProviderProfile(this.deps.invoke, id)),
        );
        const profiles = loaded.filter(
          (profile): profile is DirectProviderProfileV1 => profile !== null,
        );

        const secretEntries = await Promise.all(
          profiles.map(async (profile) => {
            if (profile.apiKeyRef === undefined) {
              return [profile.id, 'absent'] as const;
            }
            try {
              const present = await hasProviderSecret(this.deps.invoke, profile.apiKeyRef);
              return [profile.id, present ? 'present' : 'absent'] as const;
            } catch {
              // 凭据存在性查询失败时不猜测：标记 error，由 UI 明确显示存储读取失败。
              return [profile.id, 'error'] as const;
            }
          }),
        );

        // 清理指向已删除连接的孤儿 overrides。选择本身**不**被改写：
        // 悬空的 clientConnectionId 保留原 ID 由解析层给出诊断（DESK-ONLINE-002
        // 要求显式解除/替换引用，不做 silent fallback）。
        const knownIds = new Set(profiles.map((profile) => profile.id));
        const generationOverrides = Object.fromEntries(
          Object.entries(this.overlay.generationOverrides).filter(([profileId]) =>
            knownIds.has(profileId),
          ),
        );
        const modelsByProfileId = Object.fromEntries(
          Object.entries(this.overlay.modelsByProfileId).filter(([profileId]) =>
            knownIds.has(profileId),
          ),
        );
        this.overlay = {
          ...this.overlay,
          generationOverrides,
          modelsByProfileId,
        };
        this.persistOverlay();
        this.publishOverlay();

        this.publish({
          profiles,
          profilesState: 'ready',
          secretStatus: Object.fromEntries(secretEntries),
        });
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : '';
        this.publish({
          profilesState: 'failed',
          profilesError:
            `本地 Provider 配置加载失败，可以稍后重试。${detail ? `（${detail}）` : ''}`,
        });
      } finally {
        this.profilesPromise = null;
      }
    })();
    return this.profilesPromise;
  };

  /** 只改执行位置偏好；客户端连接选择保持不变（两个维度正交）。 */
  selectExecutionLocation = (location: 'client' | 'server'): void => {
    if (!this.overlayWritable) return;
    this.overlay = {
      ...this.overlay,
      selection: { ...this.overlay.selection, executionPreference: location },
    };
    this.persistOverlay();
    this.publishOverlay();
  };

  /**
   * 只改记忆里的客户端连接，**不**顺带切换执行位置。
   * 「选一条连接准备给客户端用」与「现在用客户端执行」是两件事：
   * 服务器偏好下编辑/选择连接不应偷改执行偏好（D5.0c 开放 server 后才有
   * 现实意义，但解耦现在就冻结进 API）。「立即用它执行」的完整激活
   * 语义走 `activateConnection`。
   */
  selectClientConnection = (profileId: string): void => {
    if (!this.overlayWritable) return;
    this.overlay = {
      ...this.overlay,
      selection: { ...this.overlay.selection, clientConnectionId: profileId },
    };
    this.persistOverlay();
    this.publishOverlay();
  };

  /**
   * 「设为当前 / 保存并使用」的原子激活（DESK-AIP-003.3）。
   *
   * `executionPreference='client'` + `clientConnectionId` + `selectedModelId`
   * 是**同一次**受检 overlay 更新：一次 mutate → persist → publish，
   * 不是三个可独立失败的 setter 顺次调用。失败（超限/存储写入失败）时
   * overlay 不落盘、UI 不发布——由调用方把「已保存但未启用」如实呈现，
   * 重试永远针对同一个 Profile ID。
   *
   * `modelId` 省略时沿用该连接已存的选择偏好；已存偏好悬空则回落默认模型
   * 重建立效（这是显式激活操作，不属于静默回落）。未知 Profile 或不在
   * 候选清单的 `modelId` 拒绝写入。
   */
  activateConnection = (profileId: string, modelId?: string): void => {
    if (!this.overlayWritable) return;
    const profile = this.state.profiles.find((item) => item.id === profileId);
    if (!profile) return;
    const entry = this.overlay.modelsByProfileId[profileId];
    const available = new Set([profile.modelId, ...(entry?.customModelIds ?? [])]);
    if (modelId !== undefined && !available.has(modelId)) return;
    const selectedModelId =
      modelId ??
      (entry?.selectedModelId !== undefined && available.has(entry.selectedModelId)
        ? entry.selectedModelId
        : profile.modelId);
    this.overlay = {
      ...this.overlay,
      selection: { executionPreference: 'client', clientConnectionId: profileId },
      modelsByProfileId: Object.assign(
        Object.create(null) as Record<string, DesktopProfileModelSelection>,
        this.overlay.modelsByProfileId,
        {
          [profileId]: {
            customModelIds: entry?.customModelIds ?? [],
            selectedModelId,
          },
        },
      ),
    };
    this.persistOverlay();
    this.publishOverlay();
  };

  hidePreset = (presetId: string): void => {
    if (!this.overlayWritable) return;
    if (this.overlay.hiddenPresetIds.includes(presetId)) return;
    this.overlay = {
      ...this.overlay,
      hiddenPresetIds: [...this.overlay.hiddenPresetIds, presetId],
    };
    this.persistOverlay();
    this.publishOverlay();
  };

  unhidePreset = (presetId: string): void => {
    if (!this.overlayWritable) return;
    this.overlay = {
      ...this.overlay,
      hiddenPresetIds: this.overlay.hiddenPresetIds.filter((id) => id !== presetId),
    };
    this.persistOverlay();
    this.publishOverlay();
  };

  restoreAllPresets = (): void => {
    if (!this.overlayWritable) return;
    this.overlay = { ...this.overlay, hiddenPresetIds: [] };
    this.persistOverlay();
    this.publishOverlay();
  };

  /** 写入某连接+模型的生成覆盖；undefined 表示恢复默认（删除该模型条目）。 */
  setGenerationOverrides = (
    profileId: string,
    modelId: string,
    overrides: UserGenerationOverrides | undefined,
  ): void => {
    if (!this.overlayWritable) return;
    // null-prototype 字典：profileId/modelId 允许任意合法标识符（含 "__proto__"），
    // 直接往普通对象写 untrustedKey 会走原型 setter。computed key 的 {...} literal
    // 与 Object.assign 往 null-proto 目标写入均为 own-property 语义。
    const next = Object.assign(
      Object.create(null) as Record<string, Record<string, UserGenerationOverrides>>,
      this.overlay.generationOverrides,
    );
    if (overrides === undefined) {
      const models = Object.assign(
        Object.create(null) as Record<string, UserGenerationOverrides>,
        next[profileId],
      );
      delete models[modelId];
      if (Object.keys(models).length === 0) {
        delete next[profileId];
      } else {
        next[profileId] = models;
      }
    } else {
      next[profileId] = Object.assign(
        Object.create(null) as Record<string, UserGenerationOverrides>,
        next[profileId],
        { [modelId]: overrides },
      );
    }
    this.overlay = { ...this.overlay, generationOverrides: next };
    this.persistOverlay();
    this.publishOverlay();
  };

  /** 写某连接的模型选择条目；entry 为 undefined 时删除整条（null-proto 字典）。 */
  private writeModelSelection(
    profileId: string,
    entry: DesktopProfileModelSelection | undefined,
  ): void {
    const next = Object.assign(
      Object.create(null) as Record<string, DesktopProfileModelSelection>,
      this.overlay.modelsByProfileId,
    );
    if (entry === undefined) {
      delete next[profileId];
    } else {
      next[profileId] = entry;
    }
    this.overlay = { ...this.overlay, modelsByProfileId: next };
    this.persistOverlay();
    this.publishOverlay();
  }

  /**
   * 切换连接的当前模型（DESK-AIP-006）。
   * 只写选择偏好，不改 Profile 默认模型；选择保持显式值——之后默认模型被
   * 编辑改走属于「显式选择悬空」，由解析层提示重新选择而非静默跟进。
   * 未加载的 Profile 或不在候选清单里的模型一律不写入。
   */
  selectModel = (profileId: string, modelId: string): void => {
    if (!this.overlayWritable) return;
    const profile = this.state.profiles.find((item) => item.id === profileId);
    if (!profile) return;
    const entry = this.overlay.modelsByProfileId[profileId];
    const available = new Set([profile.modelId, ...(entry?.customModelIds ?? [])]);
    if (!available.has(modelId)) return;
    this.writeModelSelection(profileId, {
      customModelIds: entry?.customModelIds ?? [],
      selectedModelId: modelId,
    });
  };

  /**
   * 为连接补充自定义模型 ID（DESK-AIP-005 边界校验）。
   * 返回规范化后的模型 ID；非法/重复输入抛错，由 UI 展示。
   * 不自动切换当前模型——「添加模型」与「选它执行」是两个显式操作。
   */
  addCustomModel = (profileId: string, modelId: string): string => {
    if (!this.overlayWritable) {
      throw new Error('AI 配置当前不可写入');
    }
    const trimmed = modelId.trim();
    if (!isValidDesktopModelId(trimmed)) {
      throw new Error('模型 ID 无效：需非空、不超过 256 字符且不含控制字符');
    }
    const profile = this.state.profiles.find((item) => item.id === profileId);
    const entry = this.overlay.modelsByProfileId[profileId];
    if (trimmed === profile?.modelId || (entry?.customModelIds ?? []).includes(trimmed)) {
      throw new Error('该模型已在当前连接的模型列表中');
    }
    this.writeModelSelection(profileId, {
      ...(entry?.selectedModelId === undefined
        ? {}
        : { selectedModelId: entry.selectedModelId }),
      customModelIds: [...(entry?.customModelIds ?? []), trimmed],
    });
    return trimmed;
  };

  /**
   * 从连接的自定义模型清单移除一项。
   * 若它正是当前选中模型，选择保留为悬空值——解析层据此提示重新选择，
   * 绝不静默回落到默认模型（DESK-AIP-006）。该模型的生成覆盖同时保留：
   * 重新添加同名模型即恢复，不隐式清空参数。
   */
  removeCustomModel = (profileId: string, modelId: string): void => {
    if (!this.overlayWritable) return;
    const entry = this.overlay.modelsByProfileId[profileId];
    if (entry === undefined || !entry.customModelIds.includes(modelId)) return;
    const customModelIds = entry.customModelIds.filter((id) => id !== modelId);
    this.writeModelSelection(
      profileId,
      customModelIds.length === 0 && entry.selectedModelId === undefined
        ? undefined
        : {
            ...(entry.selectedModelId === undefined
              ? {}
              : { selectedModelId: entry.selectedModelId }),
            customModelIds,
          },
    );
  };

  /**
   * 保存连接草稿：`ProfileDraftError.field` 供 UI 定位失败字段。
   *
   * 编辑既有连接时保留编辑器不管理的字段：未提供新明文就沿用旧 `apiKeyRef`，
   * `createdAt` 与编辑器未暴露的 header/默认参数也不被静默清掉。
   *
   * 带新 Key 的保存走 **staged secretRef** 事务：
   *   validate(带新 ref 的候选) → set(新 ref, 明文) → save(候选)
   *   ├─ 任一步失败：删除新 ref 回滚，旧 Profile + 旧凭据完全不受影响；
   *   └─ 成功：删除旧 ref。
   * 若直接往旧 `apiKeyRef` 写新 Key，`save_provider_profile` 失败会让旧 Profile
   * 静默开始使用新凭据；staged ref 即使回滚清理也失败，最多只留下一个没有任何
   * Profile 引用的孤儿 secret。ref 不拼长 profileId，避免撞 256 字符上限。
   */
  saveConnection = async (draft: ProfileDraft): Promise<void> => {
    this.publish({ savingConnection: true });
    try {
      const existing = this.state.profiles.find((item) => item.id === draft.id);
      // 编辑器 capability 独立于执行 capability：简化编辑器只表达
      // openai-compatible，其他 adapter 的旧 Profile 只读展示，不得借保存把
      // adapter 静默改写（DESK-ONLINE-003/004）。
      if (existing && !DESKTOP_EDITABLE_PROFILE_ADAPTERS.has(existing.adapter)) {
        throw new ProfileDraftError(
          'adapter',
          `当前版本的连接编辑器仅支持 openai-compatible；该连接为 ${existing.adapter}`,
        );
      }

      const built = buildProfile(draft, this.deps.now);
      const plaintextApiKey = draft.apiKey !== undefined && draft.apiKey.length > 0
        ? draft.apiKey
        : undefined;
      const clearApiKey = draft.clearApiKey === true;
      if (clearApiKey && plaintextApiKey !== undefined) {
        throw new ProfileDraftError('apiKey', '清除凭据与更换凭据不能同时生效');
      }
      const stagedApiKeyRef =
        plaintextApiKey !== undefined ? `provider-key:${crypto.randomUUID()}` : undefined;

      const transport = (() => {
        const rest = { ...(existing?.transport ?? {}) };
        delete rest.allowPublicHttp;
        const merged = draft.allowPublicHttp === true
          ? { ...rest, allowPublicHttp: true as const }
          : rest;
        return Object.keys(merged).length > 0 ? merged : undefined;
      })();
      let profile: DirectProviderProfileV1 = existing
        ? {
            ...existing,
            name: built.name,
            baseUrl: built.baseUrl,
            modelId: built.modelId,
            adapter: existing.adapter,
            transport,
            apiKeyRef: stagedApiKeyRef ?? existing.apiKeyRef,
            updatedAt: built.updatedAt,
          }
        : stagedApiKeyRef !== undefined
          ? { ...built, apiKeyRef: stagedApiKeyRef }
          : built;
      if (clearApiKey) {
        // 清除语义：Profile 不再携带凭据引用；旧凭据在落盘成功后由下方孤儿清理删除。
        const { apiKeyRef: _cleared, ...rest } = profile;
        profile = rest;
      }

      try {
        // Profile 先过 native 校验（含投影回显）再写凭据：校验失败不动凭据。
        await validateProviderExecutionProfile(this.deps.invoke, profile);
        if (stagedApiKeyRef !== undefined && plaintextApiKey !== undefined) {
          await setProviderSecret(this.deps.invoke, stagedApiKeyRef, plaintextApiKey);
        }
        await saveProviderProfile(this.deps.invoke, profile);
      } catch (cause) {
        // 回滚 staged 凭据：旧 Profile 与其 apiKeyRef 指向的凭据保持原样。
        if (stagedApiKeyRef !== undefined) {
          await deleteProviderSecret(this.deps.invoke, stagedApiKeyRef).catch(() => undefined);
        }
        throw cause;
      }
      // 保存成功后旧凭据变为孤儿，尽力清理（失败只留下不可达 secret）。
      if (
        existing?.apiKeyRef !== undefined &&
        existing.apiKeyRef !== profile.apiKeyRef
      ) {
        await deleteProviderSecret(this.deps.invoke, existing.apiKeyRef).catch(() => undefined);
      }
      await this.refreshProfiles();
      // 记住刚保存的连接作为客户端连接；不替用户切换执行位置偏好。
      this.selectClientConnection(profile.id);
    } finally {
      this.publish({ savingConnection: false });
    }
  };

  /**
   * 删除连接及其凭据，并显式解除 overlay 里的引用。
   *
   * - 凭据按被删 Profile 实际记录的 `apiKeyRef` 删除；推导 ref 对旧数据可能不准。
   * - `secretHeaderRefs` 未来可能引入共享语义，不随 Profile 盲删。
   * - 删除当前正在使用的连接时显式清掉 `clientConnectionId`，不自动换供应商
   *   （DESK-ONLINE-002）。Profile 是索引、凭据是内容；孤儿凭据比悬空 Profile 安全。
   */
  deleteConnection = async (profileId: string): Promise<void> => {
    const existing =
      this.state.profiles.find((item) => item.id === profileId) ??
      (await getProviderProfile(this.deps.invoke, profileId).catch(() => null));

    await deleteProviderProfile(this.deps.invoke, profileId);
    if (existing?.apiKeyRef !== undefined) {
      await deleteProviderSecret(this.deps.invoke, existing.apiKeyRef).catch(() => undefined);
    }

    if (this.overlay.selection.clientConnectionId === profileId && this.overlayWritable) {
      this.overlay = {
        ...this.overlay,
        selection: { ...this.overlay.selection, clientConnectionId: null },
      };
      this.persistOverlay();
      this.publishOverlay();
    }
    await this.refreshProfiles();
  };
}

export { ProfileDraftError, type ProfileDraft };
