'use client';
import type { ReactNode } from 'react';
import { CollapsibleSection } from '../creator';

export type BattleLitePageViewProps = Readonly<{
  isGenerating: boolean;
  presetCountLabel: string;
  combatantCountLabel: string;
  showScenario: boolean;
  hasScenario: boolean;
  materialCount: number;
  referenceItemCount: number;
  maxReferenceItems: number;
  /** Host copy for capabilities which differ across products. Undefined preserves Web copy; null hides a description. */
  copy?: Readonly<{ databaseTitle?: string; databaseDescription?: string | null; modeDescription?: string | null; storyOptionsDescription?: string | null }>;
  slots: Readonly<{
    header: ReactNode;
    rankingLinks: ReactNode;
    pageLinks: ReactNode;
    presets: ReactNode;
    database: ReactNode;
    localImport: ReactNode;
    roster: ReactNode;
    mode: ReactNode;
    scenario: ReactNode;
    materials: ReactNode;
    storyOptions: ReactNode;
    generationMode: ReactNode;
    actions: ReactNode;
    community: ReactNode;
    result: ReactNode;
    storySession: ReactNode;
    homeLink: ReactNode;
    footer: ReactNode;
  }>;
}>;

/** Shared Lite page composition. Controllers, routing, auth, generation and dialogs belong to each host. */
export function BattleLitePageView({ isGenerating, presetCountLabel, combatantCountLabel, showScenario,
  hasScenario, materialCount, referenceItemCount, maxReferenceItems, slots, copy }: BattleLitePageViewProps) {
  return (
      <div className="magic-background-white battle-lite-shell">
        <div className="mx-auto w-full max-w-[820px] px-4 pb-8 pt-6 sm:px-6 lg:px-8">
          <div className="battle-lite-panel rounded-[30px] px-4 py-5 sm:px-6 sm:py-6">
            {slots.header}

            {slots.rankingLinks != null || slots.pageLinks != null ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              {slots.rankingLinks}
              {slots.pageLinks}
            </div> : null}

            <div className="mt-6 space-y-4">
              {slots.presets != null ? (
<CollapsibleSection
                title="🎴 预设角色"
                description={`已选 ${presetCountLabel}，适合快速开始`}
                defaultOpen
                disabled={isGenerating}
                storageKey="battle-lite.section.presetCharacters.open"
              >
                {slots.presets}
              </CollapsibleSection>
              ) : null}

              {slots.database != null ? (
<CollapsibleSection
                title={copy?.databaseTitle ?? "🌐 在线角色库 / 随机匹配"}
                description={copy?.databaseDescription === undefined ? `当前已选 ${combatantCountLabel}` : copy.databaseDescription ?? undefined}
                defaultOpen={false}
                disabled={isGenerating}
                storageKey="battle-lite.section.characterDatabase.open"
              >
                {slots.database}
              </CollapsibleSection>
              ) : null}

              {slots.localImport != null ? (
<CollapsibleSection
                title="📁 本地导入（上传 / 粘贴）"
                description="支持上传多个 .json 或直接粘贴文本"
                defaultOpen={false}
                disabled={isGenerating}
                keepMounted
                storageKey="battle-lite.section.localImport.open"
              >
                {slots.localImport}
              </CollapsibleSection>
              ) : null}

              {slots.roster != null ? (
<CollapsibleSection
                title="👥 已选角色 / 分队"
                description={`已选 ${combatantCountLabel}`}
                defaultOpen
                disabled={isGenerating}
                keepMounted
                storageKey="battle-lite.section.combatants.open"
              >
                {slots.roster}
              </CollapsibleSection>
              ) : null}

              {slots.mode != null ? (
<CollapsibleSection
                title="🎮 模式选择"
                description={copy?.modeDescription === undefined ? "不同模式会影响输出风格与计分规则" : copy.modeDescription ?? undefined}
                defaultOpen
                disabled={isGenerating}
                storageKey="battle-lite.section.battleMode.open"
              >
                {slots.mode}
              </CollapsibleSection>
              ) : null}

              {showScenario && slots.scenario != null && (
                <CollapsibleSection
                  title="🎭 情景设置"
                  description={hasScenario ? '仅保留主情景，避免主流程过载' : '当前还未选择主情景'}
                  defaultOpen
                  autoOpen={!hasScenario}
                  disabled={isGenerating}
                  keepMounted
                  storageKey="battle-lite.section.scenario.open"
                >
                  {slots.scenario}
                </CollapsibleSection>
              )}

              {slots.materials != null ? (
<CollapsibleSection
                title="📎 素材注入"
                description={`已选素材 ${materialCount}；参考项合计 ${referenceItemCount}/${maxReferenceItems}`}
                defaultOpen={false}
                disabled={isGenerating}
                keepMounted
                storageKey="battle-lite.section.materials.open"
              >
                {slots.materials}
              </CollapsibleSection>
              ) : null}

              {slots.storyOptions != null ? (
<CollapsibleSection
                title="🧠 故事方向引导 / AI 提供商"
                description={copy?.storyOptionsDescription === undefined ? "如需其他高级项请前往完整版竞技场" : copy.storyOptionsDescription ?? undefined}
                defaultOpen
                disabled={isGenerating}
                keepMounted
                storageKey="battle-lite.section.storyOptions.open"
              >
                {slots.storyOptions}
              </CollapsibleSection>
              ) : null}

              {slots.generationMode != null ? (
<CollapsibleSection
                title="⚡ 生成方式"
                description="流式生成可边生成边阅读；非流式适合一次性结果"
                defaultOpen={false}
                disabled={isGenerating}
                storageKey="battle-lite.section.generationMode.open"
              >
                {slots.generationMode}
              </CollapsibleSection>
              ) : null}

              {slots.actions != null ? (
<CollapsibleSection
                title="🚀 开始生成"
                description="确认设置后点击按钮生成战报"
                collapsible={false}
              >
                {slots.actions}
              </CollapsibleSection>
              ) : null}

              {slots.community != null ? (
<CollapsibleSection
                title="💬 社区"
                description="QQ群 / 腾讯频道"
                defaultOpen={false}
                storageKey="battle-lite.section.community.open"
              >
                {slots.community}
              </CollapsibleSection>
              ) : null}
            </div>
          </div>

          {slots.result}
          {slots.storySession}

          {slots.homeLink != null ? <div className="mt-8 text-center">
            {slots.homeLink}
          </div> : null}

          {slots.footer}
        </div>
      </div>
  );
}
