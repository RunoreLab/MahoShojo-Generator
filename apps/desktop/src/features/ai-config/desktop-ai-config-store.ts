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
  desktopConnectionOverridesScope,
  parseDesktopAiConfigOverlay,
  serializeDesktopAiConfigOverlay,
  type DesktopAiConfigOverlay,
  type DesktopAiSelection,
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
  generationOverrides: Readonly<Record<string, UserGenerationOverrides>>;
  profiles: readonly DirectProviderProfileV1[];
  profilesState: DesktopAiProfilesState;
  profilesError: string | null;
  /** profileId → 是否存在已保存凭据；只回答存在性，永不读回明文。 */
  secretStatus: Readonly<Record<string, boolean>>;
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
            if (profile.apiKeyRef === undefined) return [profile.id, false] as const;
            try {
              return [profile.id, await hasProviderSecret(this.deps.invoke, profile.apiKeyRef)] as const;
            } catch {
              // 凭据存在性查询失败时不猜测：按未知→false 处理，UI 提示用户重新录入。
              return [profile.id, false] as const;
            }
          }),
        );

        // 清理指向已删除连接的 overlay 引用（选择项与孤儿 overrides）。
        const knownIds = new Set(profiles.map((profile) => profile.id));
        const selection: DesktopAiSelection = (() => {
          const dangling =
            this.overlay.selection.kind === 'connection' &&
            !knownIds.has(this.overlay.selection.profileId);
          // 'server' 位置当前禁用，不存在「显式选择服务器」的持久偏好：悬空或无
          // 连接选择时自动选中第一条可用连接（沿用旧详情页的 available[0] 语义）。
          if ((dangling || this.overlay.selection.kind === 'server') && profiles.length > 0) {
            return { kind: 'connection', profileId: profiles[0]!.id };
          }
          return dangling ? { kind: 'server' } : this.overlay.selection;
        })();
        const generationOverrides = Object.fromEntries(
          Object.entries(this.overlay.generationOverrides).filter(([scope]) =>
            knownIds.has(scope.split('::')[0] ?? ''),
          ),
        );
        this.overlay = {
          selection,
          hiddenPresetIds: this.overlay.hiddenPresetIds,
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

  selectServer = (): void => {
    if (!this.overlayWritable) return;
    this.overlay = { ...this.overlay, selection: { kind: 'server' } };
    this.persistOverlay();
    this.publishOverlay();
  };

  selectConnection = (profileId: string): void => {
    if (!this.overlayWritable) return;
    this.overlay = {
      ...this.overlay,
      selection: { kind: 'connection', profileId },
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

  /** 写入某连接+模型的生成覆盖；undefined 表示恢复默认（删除 scope）。 */
  setGenerationOverrides = (
    profileId: string,
    modelId: string,
    overrides: UserGenerationOverrides | undefined,
  ): void => {
    if (!this.overlayWritable) return;
    const scope = desktopConnectionOverridesScope(profileId, modelId);
    const next = { ...this.overlay.generationOverrides };
    if (overrides === undefined) {
      delete next[scope];
    } else {
      next[scope] = overrides;
    }
    this.overlay = { ...this.overlay, generationOverrides: next };
    this.persistOverlay();
    this.publishOverlay();
  };

  /**
   * 保存连接草稿：先写凭据再落 Profile（顺序与 `saveProfileDraft` 注释一致，
   * 不能反过来），随后刷新列表。`ProfileDraftError.field` 供 UI 定位失败字段。
   *
   * 编辑既有连接时保留编辑器不管理的字段：未提供新明文就沿用旧 `apiKeyRef`，
   * `createdAt` 与编辑器未暴露的 header/默认参数也不被静默清掉。
   */
  saveConnection = async (draft: ProfileDraft): Promise<void> => {
    this.publish({ savingConnection: true });
    try {
      const built = buildProfile(draft, this.deps.now);
      const plaintextApiKey = draft.apiKey !== undefined && draft.apiKey.length > 0
        ? draft.apiKey
        : undefined;
      if (plaintextApiKey !== undefined) {
        await setProviderSecret(this.deps.invoke, deriveApiKeyRef(built.id), plaintextApiKey);
      }

      const existing = this.state.profiles.find((item) => item.id === built.id);
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
            adapter: built.adapter,
            transport,
            apiKeyRef: plaintextApiKey !== undefined ? built.apiKeyRef : existing.apiKeyRef,
            updatedAt: built.updatedAt,
          }
        : built;

      // provider-profile-bridge 内部完成 native 投影回显校验后再落盘。
      await saveProviderProfile(this.deps.invoke, profile);
      await this.refreshProfiles();
      // 新建的连接直接成为当前选择——用户保存它就是为了用它。
      this.selectConnection(profile.id);
    } finally {
      this.publish({ savingConnection: false });
    }
  };

  /** 删除连接 + 凭据，并清掉 overlay 里的相关引用。 */
  deleteConnection = async (profileId: string): Promise<void> => {
    await deleteProviderProfile(this.deps.invoke, profileId);
    // Profile 是索引、凭据是内容；孤儿凭据比悬空 Profile 安全（沿用 removeProfile 的语义）。
    await deleteProviderSecret(this.deps.invoke, deriveApiKeyRef(profileId)).catch(() => undefined);
    await this.refreshProfiles();
  };
}

export { ProfileDraftError, type ProfileDraft };
