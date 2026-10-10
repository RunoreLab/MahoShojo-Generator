'use client';
import { ArenaEditorWorkspaceLayout as SharedArenaEditorWorkspaceLayout, type ArenaEditorWorkspaceSection as SharedSection } from '@mahoshojo/ui-web/arena';

export type ArenaEditorSectionKind =
  | 'presetCharacters'
  | 'characterDatabase'
  | 'localImport'
  | 'roster'
  | 'battleMode'
  | 'scenario'
  | 'materials'
  | 'ranking'
  | 'settings'
  | 'story'
  | 'generationMode'
  | 'generationActions'
  | 'community';

export type ArenaEditorWorkspaceSection = Omit<SharedSection, 'title' | 'column' | 'storageKey' | 'kind'> & { readonly kind: ArenaEditorSectionKind };

const SECTION_META: Record<
  ArenaEditorSectionKind,
  { readonly title: string; readonly column: 'left' | 'right'; readonly storageKey: string }
> = {
  presetCharacters: {
    title: '🎴 预设角色',
    column: 'left',
    storageKey: 'arena.section.presetCharacters.open',
  },
  characterDatabase: {
    title: '🌐 在线角色库 / 随机匹配',
    column: 'left',
    storageKey: 'arena.section.characterDatabase.open',
  },
  localImport: {
    title: '📁 本地导入（上传 / 粘贴）',
    column: 'left',
    storageKey: 'arena.section.localImport.open',
  },
  roster: {
    title: '👥 已选角色 / 分队',
    column: 'left',
    storageKey: 'arena.section.combatants.open',
  },
  battleMode: {
    title: '🎮 模式选择',
    column: 'right',
    storageKey: 'arena.section.battleMode.open',
  },
  scenario: {
    title: '🎭 情景设置',
    column: 'right',
    storageKey: 'arena.section.scenario.open',
  },
  materials: {
    title: '📎 素材注入',
    column: 'right',
    storageKey: 'arena.section.materials.open',
  },
  ranking: {
    title: '🏁 排位与快速设置',
    column: 'right',
    storageKey: 'arena.section.rankingQuickActions.open',
  },
  settings: {
    title: '⚙️ 读写设置（历战 / 当前状态 / 叙事历史）',
    column: 'right',
    storageKey: 'arena.section.battleSettings.open',
  },
  story: {
    title: '🧠 故事引导 / 判定 / AI 模型',
    column: 'right',
    storageKey: 'arena.section.storyOptions.open',
  },
  generationMode: {
    title: '⚡ 生成方式',
    column: 'right',
    storageKey: 'arena.section.generationMode.open',
  },
  generationActions: {
    title: '🚀 开始生成',
    column: 'right',
    storageKey: 'arena.section.generationActions.open',
  },
  community: {
    title: '💬 社区',
    column: 'right',
    storageKey: 'arena.section.community.open',
  },
};

export function ArenaEditorWorkspaceLayout({ sections, disabled = false }: { readonly sections: readonly ArenaEditorWorkspaceSection[]; readonly disabled?: boolean }) {
  return <SharedArenaEditorWorkspaceLayout disabled={disabled} sections={sections.map((section) => ({ ...SECTION_META[section.kind], ...section }))} />;
}
