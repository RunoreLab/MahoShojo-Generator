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
  deriveApiKeyRef,
  type ProfileDraft,
} from '../providers/profile-draft';

import {
  DESKTOP_AI_CONFIG_DEFAULT_OVERLAY,
  parseDesktopAiConfigOverlay,
  serializeDesktopAiConfigOverlay,
  type DesktopAiConfigOverlay,
  type DesktopAiSelection,
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
      generationOverrides: { ...this.overlay.generationOverrides },
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
        this.overlay = {
          ...this.overlay,
          generationOverrides,
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

  /** 选择一条客户端连接；同时把执行偏好落到 client——选中即表示要用它执行。 */
  selectConnection = (profileId: string): void => {
    if (!this.overlayWritable) return;
    this.overlay = {
      ...this.overlay,
      selection: { executionPreference: 'client', clientConnectionId: profileId },
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
    const next = { ...this.overlay.generationOverrides };
    if (overrides === undefined) {
      const models = { ...(next[profileId] ?? {}) };
      delete models[modelId];
      if (Object.keys(models).length === 0) {
        delete next[profileId];
      } else {
        next[profileId] = models;
      }
    } else {
      next[profileId] = { ...(next[profileId] ?? {}), [modelId]: overrides };
    }
    this.overlay = { ...this.overlay, generationOverrides: next };
    this.persistOverlay();
    this.publishOverlay();
  };

  /**
   * 保存连接草稿：先做 native 校验，再写凭据，最后落 Profile（顺序与
   * `saveProfileDraft` 注释一致），随后刷新列表。`ProfileDraftError.field` 供 UI
   * 定位失败字段。
   *
   * 编辑既有连接时保留编辑器不管理的字段：未提供新明文就沿用旧 `apiKeyRef`，
   * `createdAt` 与编辑器未暴露的 header/默认参数也不被静默清掉。
   */
  saveConnection = async (draft: ProfileDraft): Promise<void> => {
    this.publish({ savingConnection: true });
    try {
      const existing = this.state.profiles.find((item) => item.id === draft.id);
      // 简化编辑器只表达 openai-compatible；其他 adapter 的旧 Profile 只读展示，
      // 不得借保存把 adapter 静默改写（DESK-ONLINE-003/004）。
      if (existing && existing.adapter !== 'openai-compatible') {
        throw new ProfileDraftError(
          'adapter',
          `当前版本的连接编辑器仅支持 openai-compatible；该连接为 ${existing.adapter}`,
        );
      }

      const built = buildProfile(draft, this.deps.now);
      const plaintextApiKey = draft.apiKey !== undefined && draft.apiKey.length > 0
        ? draft.apiKey
        : undefined;

      const transport = (() => {
        const rest = { ...(existing?.transport ?? {}) };
        delete rest.allowPublicHttp;
        const merged = draft.allowPublicHttp === true
          ? { ...rest, allowPublicHttp: true as const }
          : rest;
        return Object.keys(merged).length > 0 ? merged : undefined;
      })();
      const profile: DirectProviderProfileV1 = existing
        ? {
            ...existing,
            name: built.name,
            baseUrl: built.baseUrl,
            modelId: built.modelId,
            adapter: existing.adapter,
            transport,
            apiKeyRef: plaintextApiKey !== undefined ? built.apiKeyRef : existing.apiKeyRef,
            updatedAt: built.updatedAt,
          }
        : built;

      // Profile 先过 native 校验（含投影回显），凭据写入放到校验之后：否则编辑既有
      // 连接时会出现「凭据已更新但 Profile 保存失败」的部分成功窗口，旧 Profile 会
      // 静默开始使用新 Key。
      await validateProviderExecutionProfile(this.deps.invoke, profile);
      if (plaintextApiKey !== undefined) {
        await setProviderSecret(this.deps.invoke, deriveApiKeyRef(built.id), plaintextApiKey);
      }
      await saveProviderProfile(this.deps.invoke, profile);
      // apiKeyRef 因重输 Key 而更换时清理旧凭据，避免孤儿 secret 留在系统钥匙串。
      if (
        existing?.apiKeyRef !== undefined &&
        existing.apiKeyRef !== profile.apiKeyRef
      ) {
        await deleteProviderSecret(this.deps.invoke, existing.apiKeyRef).catch(() => undefined);
      }
      await this.refreshProfiles();
      // 新建的连接直接成为当前选择——用户保存它就是为了用它。
      this.selectConnection(profile.id);
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
