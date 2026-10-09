import type { SettingsGroupId } from './groups';

/**
 * 首批设置项的字段权威登记（DESK-SET-003 / DESK-SET-007）。
 *
 * 每个字段恰好一个持久化 owner；这份表是「谁拥有什么」的机器可读记录，
 * 也是审查「设置页会不会变成第二权威」的对照面。`wired` = 当前切片已接入
 * UI 的真实消费者；`planned` = 已确认归属、等待各自消费切片（S2/N1/P1/K1），
 * 在落地前不出现在设置页。
 *
 * 注意与 specs/2026-10-06_084200 的字段表保持一致：改 owner/默认值要先改
 * 规格，不是先改这张表。
 */
/** 单宿主的页偏好 owner 事实：真实存储键 + 文档形态。 */
export interface PagePreferenceOwnerFacts {
  storageKey: string;
  scope: 'blob' | 'fields';
}

export type SettingsHostId = 'web' | 'desktop';

export type SettingOwner =
  | { kind: 'device-storage'; storageKey: string }
  | {
      kind: 'page-preferences';
      /**
       * 每宿主真实 owner——同一「页偏好」在两端的持久化形态不同：
       * Web 是独立偏好 blob，Desktop 是草稿文档内字段。键与 scope 必须
       * 与各宿主 `PagePreferenceSource` 装配逐字一致（宿主侧测试钉住）。
       * 只含 `hosts` 声明存在的宿主键。
       */
      byHost: Partial<Record<SettingsHostId, PagePreferenceOwnerFacts>>;
    }
  | { kind: 'config-json'; key: string }
  | { kind: 'existing-store'; description: string }
  | { kind: 'server' };

export type SettingScope = 'device' | 'account' | 'host-file' | 'server';

export interface SettingsFieldRecord {
  /** 登记名（向 spec 字段名靠拢）。 */
  id: string;
  group: SettingsGroupId;
  label: string;
  /** 哪些宿主有这个字段。 */
  hosts: 'shared' | 'web' | 'desktop';
  scope: SettingScope;
  owner: SettingOwner;
  defaultValue: string;
  status: 'wired' | 'planned';
  notes?: string;
}

export const SETTINGS_FIELD_REGISTRY: readonly SettingsFieldRecord[] = [
  {
    id: 'appearance.colorMode',
    group: 'appearance',
    label: '主题',
    hosts: 'shared',
    scope: 'device',
    owner: { kind: 'device-storage', storageKey: 'mahoshojo.color-mode' },
    defaultValue: 'system',
    status: 'wired',
    notes: '先于本切片存在（D5.0d），此处登记既有 owner。',
  },
  {
    id: 'appearance.motion',
    group: 'appearance',
    label: '减少动态效果',
    hosts: 'shared',
    scope: 'device',
    owner: { kind: 'device-storage', storageKey: 'mahoshojo.motion-preference' },
    defaultValue: 'system',
    status: 'wired',
    notes: 'system|reduce；reduce 等同系统减少动效，写 data-motion 根标记。',
  },
  {
    id: 'appearance.resultAutoScroll',
    group: 'appearance',
    label: '结果自动定位',
    hosts: 'shared',
    scope: 'device',
    owner: { kind: 'device-storage', storageKey: 'mahoshojo.result-auto-scroll' },
    defaultValue: 'on',
    status: 'wired',
    notes: '控制共享结果定位 hook；首次可预览触发，恢复与历史不触发；其余语义见 DESK-PARITY-004。',
  },
  {
    id: 'generation.detailsPreferences',
    group: 'generation',
    label: '生成页记忆偏好',
    hosts: 'shared',
    scope: 'device',
    owner: {
      kind: 'page-preferences',
      byHost: {
        web: { storageKey: 'mahoshojo.details.preferences.v1', scope: 'blob' },
        desktop: {
          storageKey: 'mahoshojo.desktop.details.draft.v1',
          scope: 'fields',
        },
      },
    },
    defaultValue: '各页现有默认',
    status: 'wired',
    notes: '设置页经同一 adapter 查看/修改/重置；重置不碰草稿与结果。',
  },
  {
    id: 'generation.canshouPreferences',
    group: 'generation',
    label: '残兽页记忆偏好',
    hosts: 'shared',
    scope: 'device',
    owner: {
      kind: 'page-preferences',
      byHost: {
        web: { storageKey: 'mahoshojo.canshou.preferences.v1', scope: 'blob' },
        desktop: {
          storageKey: 'mahoshojo.desktop.canshou.draft.v1',
          scope: 'fields',
        },
      },
    },
    defaultValue: '各页现有默认',
    status: 'wired',
  },
  {
    id: 'generation.freePreferences',
    group: 'generation',
    label: '自由生成页记忆偏好',
    hosts: 'shared',
    scope: 'device',
    owner: {
      kind: 'page-preferences',
      byHost: {
        web: { storageKey: 'mahoshojo.free-generator.draft.v1', scope: 'fields' },
        desktop: { storageKey: 'mahoshojo.desktop.free.draft.v1', scope: 'fields' },
      },
    },
    defaultValue: '两个展开开关均为 false',
    status: 'wired',
    notes: '仅字段速览/生成语言展开偏好；草稿模式、语言、内容与结果不在重置范围。',
  },
  {
    id: 'generation.creatorPreferences', group: 'generation', label: '创作工房记忆偏好', hosts: 'desktop', scope: 'device',
    owner: { kind: 'page-preferences', byHost: { desktop: { storageKey: 'mahoshojo.desktop.creator.draft.v1', scope: 'fields' } } },
    defaultValue: '各页现有默认', status: 'wired',
    notes: 'Desktop 只改保存方式、设定说明和多问卷；语言/模式只读。Web Creator 共用 Details owner。',
  },
  {
    id: 'generation.scenarioPreferences', group: 'generation', label: '情景生成记忆偏好', hosts: 'shared', scope: 'device',
    owner: { kind: 'page-preferences', byHost: {
      web: { storageKey: 'mahoshojo.scenario.page-draft.v1', scope: 'fields' },
      desktop: { storageKey: 'mahoshojo.desktop.scenario.draft.v1', scope: 'fields' },
    } },
    defaultValue: '高级选项展开为 false', status: 'wired',
    notes: 'Web payload.isAdvancedVisible 是唯一权威，旧 preferences 同字段仅为迁移源。',
  },
  {
    id: 'generation.sublimationPreferences', group: 'generation', label: '升华展开偏好', hosts: 'shared', scope: 'device',
    owner: { kind: 'page-preferences', byHost: {
      web: { storageKey: 'mahoshojo.sublimation.preferences.v1', scope: 'fields' },
      desktop: { storageKey: 'mahoshojo.desktop.sublimation.draft.v1', scope: 'fields' },
    } },
    defaultValue: '高级选项展开为 false', status: 'wired',
    notes: '只操作展开项，保留同文档的指导语、问卷、保留字段、卡与结果。',
  },
  {
    id: 'generation.sublimationStatePreferences', group: 'generation', label: '升华历史与状态策略', hosts: 'shared', scope: 'device',
    owner: { kind: 'page-preferences', byHost: {
      web: { storageKey: 'sublimation-history-state-preferences-v1', scope: 'fields' },
      desktop: { storageKey: 'mahoshojo.desktop.sublimation.draft.v1', scope: 'fields' },
    } },
    defaultValue: '四读写项 true；keep-sublimation-only', status: 'wired',
    notes: '沿各自现有 owner；Desktop 重置写回必填默认，Web 仅移除五个可选偏好字段。',
  },
  {
    id: 'desktop.escapeMenu.enabled',
    group: 'appearance',
    label: 'Esc 快捷菜单',
    hosts: 'desktop',
    scope: 'host-file',
    owner: { kind: 'config-json', key: 'desktop.escapeMenu.enabled' },
    defaultValue: 'true',
    status: 'wired',
    notes: 'N1 落地（DESK-PARITY-007）：Desktop 外观组控件直写 config.json；非法值回默认并诊断；Web 不渲染。',
  },
  {
    id: 'announcements.checkPolicy',
    group: 'online',
    label: '公告检查策略',
    hosts: 'desktop',
    scope: 'host-file',
    owner: { kind: 'config-json', key: 'announcements.checkPolicy' },
    defaultValue: 'on-launch',
    status: 'wired',
    notes: 'S2 接入 config.json；非法值按默认处理并诊断。',
  },
  {
    id: 'externalLinks.confirmContentLinks',
    group: 'online',
    label: '内容外链确认',
    hosts: 'desktop',
    scope: 'host-file',
    owner: { kind: 'config-json', key: 'externalLinks.confirmContentLinks' },
    defaultValue: 'true',
    status: 'wired',
    notes: 'S2 接入 config.json；非法值按 true（更保守）处理并诊断。',
  },
  {
    id: 'publicLibraryCache.captureEnabled',
    group: 'data',
    label: '缓存公开资料',
    hosts: 'desktop',
    scope: 'host-file',
    owner: { kind: 'config-json', key: 'publicLibraryCache.captureEnabled' },
    defaultValue: 'true',
    status: 'wired',
    notes: 'K1 落地（DESK-CACHE-008）：Desktop「数据」组缓存卡直写 config.json；组不可校验时整组降级为暂停捕获且不淘汰。',
  },
  {
    id: 'publicLibraryCache.maxBytes',
    group: 'data',
    label: '缓存大小上限',
    hosts: 'desktop',
    scope: 'host-file',
    owner: { kind: 'config-json', key: 'publicLibraryCache.maxBytes' },
    defaultValue: '268435456（256 MiB）',
    status: 'wired',
    notes: 'K1 落地：设置卡预设档直写；合法域含 "unlimited"，手填非预设值在卡上如实展示。',
  },
  {
    id: 'publicLibraryCache.whenFull',
    group: 'data',
    label: '缓存满额策略',
    hosts: 'desktop',
    scope: 'host-file',
    owner: { kind: 'config-json', key: 'publicLibraryCache.whenFull' },
    defaultValue: 'pause',
    status: 'wired',
    notes: 'K1 落地：默认 pause（满额只暂停新增长）；evict-least-recently-used 须用户显式开启。',
  },
  {
    id: 'account.profile',
    group: 'account',
    label: '账号资料与安全',
    hosts: 'shared',
    scope: 'server',
    owner: { kind: 'server' },
    defaultValue: '服务器权威',
    status: 'wired',
    notes: '服务器为 owner；个性签名编辑/确认保存已双端共源，Desktop 仅开放 signature 窄写入。头像修改与敏感账号流程仍归各自后续切片；本地只是展示缓存/草稿，详见 DESK-SET-002。',
  },
  {
    id: 'ai.providerProfiles',
    group: 'generation',
    label: 'AI 连接与凭据',
    hosts: 'desktop',
    scope: 'device',
    owner: {
      kind: 'existing-store',
      description: '既有 singleton overlay + SQLite Provider Profile + OS secret store',
    },
    defaultValue: '既有默认',
    status: 'wired',
    notes: 'DESK-SET-003：不迁入配置文件、不双写；凭据只走 secret store。',
  },
];
