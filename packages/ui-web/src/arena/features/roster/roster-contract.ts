import type { ReactNode } from 'react';

/**
 * 共享 roster/分队区块的 UI contract。
 * 只暴露归一化 view data、capability 与用户动作；
 * 状态容器（单人 battle store / proposal editor session）由各自 adapter 持有，
 * 共享视图不得 import 任何 store、Room controller 或网络 client。
 */

export type ArenaRosterTeamView = Readonly<{
  key: string;
  name: string;
  /** 展示与队内重排使用同一顺序：solo 为全局 roster 顺序，proposal 为 team.combatantKeys 顺序。 */
  memberKeys: readonly string[];
  collapsed: boolean;
}>;

export type ArenaRosterRowView = Readonly<{
  key: string;
  displayName: string;
  /** 展示名是解析结果（如 房间公开卡名称）时可附带的完整引用标识（hover title）。 */
  referenceTitle?: string;
  typeLabel: string;
  guidance: string;
  /** 全局 roster 下标；全局重排语义使用。 */
  index: number;
  teamKey: string | null;
  isPlaceholder: boolean;
}>;

/**
 * 每行 solo 专属插槽（标签 / 排位 / 详情 / 下载 / 复制）。
 * 共享视图只负责透传，不解释内容；proposal adapter 不提供该函数。
 */
export type ArenaRosterRowExtras = Readonly<{
  tags?: ReactNode;
  rankingBadge?: ReactNode;
  ranking?: ReactNode;
  copied?: boolean;
  onShowDetails?: () => void;
  onDownload?: () => void;
  onCopy?: () => void;
}>;

export type ArenaRosterSectionCapabilities = Readonly<{
  reorderRows: boolean;
  removeRows: boolean;
  editGuidance: boolean;
  /** 允许渲染排位/技术值等单人敏感插槽。 */
  ranking: boolean;
  addPlaceholders: boolean;
  clearRoster: boolean;
  createTeams: boolean;
  renameTeams: boolean;
  removeTeams: boolean;
  reorderTeams: boolean;
  assignTeamMembers: boolean;
  reorderTeamMembers: boolean;
  collapseTeams: boolean;
}>;

export type ArenaRosterPlaceholderType = 'random-magical-girl' | 'random-canshou';

export type ArenaRosterSectionActions = Readonly<{
  moveRow(from: number, to: number): void;
  removeRow(key: string): void;
  setGuidance(key: string, value: string): void;
  addPlaceholder(type: ArenaRosterPlaceholderType): void;
  clearRoster(): void;
  /** 创建默认命名的分队并返回其 key，供共享视图进入内联重命名。 */
  createTeam(): string;
  renameTeam(key: string, name: string): void;
  removeTeam(key: string): void;
  /** capability 关闭时不会被调用；adapter 可提供 no-op。 */
  moveTeam(key: string, direction: -1 | 1): void;
  assignCombatant(combatantKey: string, teamKey: string | null): void;
  moveTeamMember(teamKey: string, fromIndex: number, toIndex: number): void;
  toggleTeamCollapsed(key: string): void;
}>;

export type ArenaRosterSectionModel = Readonly<{
  rows: readonly ArenaRosterRowView[];
  teams: readonly ArenaRosterTeamView[];
  capabilities: ArenaRosterSectionCapabilities;
  disabled: boolean;
  combatantCountLabel: string;
  /** 参战者数量达到上限时禁用“添加随机”入口（仅 addPlaceholders 模式使用）。 */
  combatantCapReached: boolean;
  rowExtras?(row: ArenaRosterRowView): ArenaRosterRowExtras | undefined;
  actions: ArenaRosterSectionActions;
}>;
