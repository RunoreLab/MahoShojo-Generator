/**
 * 共同设置页的分组骨架（DESK-SET-001）。
 *
 * 分组名称与顺序两端一致；宿主只决定每个分组里放什么内容——某个分组在
 * 宿主上没有任何可用条目时整体隐藏，不留空节或占位开关（DESK-PROD-001
 * 同一口径）。`?section=<id>` 是两宿主共用的章节定位参数：Web 是
 * `/settings?section=account`，Desktop hash-history 下同样落进
 * `validateSearch` 的 search 里。
 */
export const SETTINGS_SECTION_PARAM = 'section';

export const SETTINGS_GROUPS = [
  { id: 'account', label: '账号与资料' },
  { id: 'appearance', label: '外观与交互' },
  { id: 'generation', label: 'AI 与生成' },
  { id: 'online', label: '在线与通知' },
  { id: 'data', label: '数据与存储' },
  { id: 'advanced', label: '高级' },
] as const;

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]['id'];

export const SETTINGS_GROUP_IDS: readonly SettingsGroupId[] = SETTINGS_GROUPS.map(
  (group) => group.id,
);

export const isSettingsGroupId = (value: unknown): value is SettingsGroupId =>
  SETTINGS_GROUP_IDS.includes(value as SettingsGroupId);

/** 分组锚点 id：`#settings-account` 形态，供深链与页内跳转共用。 */
export const settingsGroupAnchorId = (group: SettingsGroupId): string => `settings-${group}`;
