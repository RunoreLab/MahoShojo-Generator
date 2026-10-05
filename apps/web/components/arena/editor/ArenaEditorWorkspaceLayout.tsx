'use client';

import type { ReactNode } from 'react';

import { CollapsibleSection } from '@/components/shared/CollapsibleSection';

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

export type ArenaEditorWorkspaceSection = {
  readonly kind: ArenaEditorSectionKind;
  readonly content: ReactNode;
  readonly description: ReactNode;
  readonly defaultOpen?: boolean;
  readonly autoOpen?: boolean;
  readonly disabled?: boolean;
  readonly keepMounted?: boolean;
  readonly collapsible?: boolean;
};

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

const ArenaEditorSection = ({
  section,
  globallyDisabled,
}: {
  readonly section: ArenaEditorWorkspaceSection;
  readonly globallyDisabled: boolean;
}) => {
  const meta = SECTION_META[section.kind];
  return (
    <CollapsibleSection
      title={meta.title}
      description={section.description}
      defaultOpen={section.defaultOpen}
      autoOpen={section.autoOpen}
      disabled={section.disabled ?? globallyDisabled}
      keepMounted={section.keepMounted}
      collapsible={section.collapsible}
      storageKey={meta.storageKey}
    >
      {section.content}
    </CollapsibleSection>
  );
};

export function ArenaEditorWorkspaceLayout({
  sections,
  disabled = false,
}: {
  readonly sections: readonly ArenaEditorWorkspaceSection[];
  readonly disabled?: boolean;
}) {
  const left = sections.filter((section) => SECTION_META[section.kind].column === 'left');
  const right = sections.filter((section) => SECTION_META[section.kind].column === 'right');
  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,440px)_minmax(0,1fr)] xl:items-start">
      <div className="min-w-0 space-y-4">
        {left.map((section) => (
          <ArenaEditorSection key={section.kind} section={section} globallyDisabled={disabled} />
        ))}
      </div>
      <div className="min-w-0 space-y-4">
        {right.map((section) => (
          <ArenaEditorSection key={section.kind} section={section} globallyDisabled={disabled} />
        ))}
      </div>
    </div>
  );
}
