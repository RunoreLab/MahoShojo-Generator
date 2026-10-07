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
    notes: '控制共享 useResultAutoScroll；其余语义见 DESK-PARITY-004。',
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
    id: 'desktop.escapeMenu.enabled',
    group: 'appearance',
    label: 'Esc 快捷菜单',
    hosts: 'desktop',
    scope: 'host-file',
    owner: { kind: 'config-json', key: 'desktop.escapeMenu.enabled' },
    defaultValue: 'true',
    status: 'planned',
    notes: 'N1 切片随首个真实消费者落地（DESK-PARITY-007），S1 不显示。',
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
    id: 'publicLibraryCache',
    group: 'data',
    label: '公开库缓存',
    hosts: 'desktop',
    scope: 'host-file',
    owner: { kind: 'config-json', key: 'publicLibraryCache.*' },
    defaultValue: '见 DESK-CACHE-008',
    status: 'planned',
    notes: 'K1/K2；非法值暂停捕获且不淘汰。',
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
    notes: '服务器为 owner；本地只是展示缓存/草稿，详见 DESK-SET-002。',
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
