import type { ReactNode } from 'react';

import { inferDataCardTemplate } from '@mahoshojo/domain/data-cards';
import type { AdjudicatorEvent } from '@mahoshojo/domain/arena-types';

import {
  DataCardFieldEditor,
  type DataCardFieldAddon,
  type DataCardFieldEditorClasses,
  type DataCardFieldPath,
} from '../card-editor';
import { CharacterManagerArenaHistorySection, type ArenaHistoryLike } from './arena-history-section';
import { CharacterManagerCurrentStateSection } from './current-state-section';
import AdjudicatorEditor from './adjudicator-editor';
import ScenarioEditor from './scenario-editor';
import ScenarioBattleStoryPlanEditor from './scenario-battle-story-plan-editor';
import type { CharacterCurrentState } from '@mahoshojo/domain/arena-types';

/** 字段路径：共源编辑器给逐段数组，ScenarioEditor 等旧调用方给点分串。 */
export type CharacterManagerFieldPath = string | DataCardFieldPath;

export interface CharacterManagerEditorBodyProps {
  /** 当前编辑数据。 */
  readonly data: Record<string, unknown>;
  /** 写回字段；`path` 形态见 `CharacterManagerFieldPath`，宿主统一展开。 */
  readonly onFieldChange: (path: CharacterManagerFieldPath, value: unknown) => void;
  /** 编辑区标题（宿主决定「编辑角色：X / 编辑情景：X / 本地记录」语义）。 */
  readonly title: ReactNode;
  /** 标题右侧徽标（Web：原生/衍生；Desktop：本地库记录标记）。 */
  readonly badge?: ReactNode;
  /** 标题行下方、编辑区上方的宿主块（Desktop：记录标题与类型）。 */
  readonly headerExtra?: ReactNode;
  /** `DataCardFieldEditor` 的样式类注入（Web 传全局 input-field 族）。 */
  readonly classes?: DataCardFieldEditorClasses;
  /** 字段辅助片段（宿主用 `characterManagerNameFieldAddon` 与本端提示合并）。 */
  readonly renderFieldAddon?: (path: DataCardFieldPath, displayPath: string) => DataCardFieldAddon;
  /** 字段编辑区下方的全部动作区（保存/导出/加载其他数据——宿主差异面）。 */
  readonly bottomActions?: ReactNode;
  /** 「内嵌随机事件管理」的 legend 文案。 */
  readonly adjudicationLegend?: ReactNode;
  /** 「历战记录管理」的 confirm 覆盖（默认 window.confirm）。 */
  readonly confirmClearHistory?: (text: string) => boolean;
  /** 「当前状态」摘要框下方说明（Web：原生签名提示；Desktop：本机语义提示）。 */
  readonly currentStateSummaryHint?: string;
  readonly createId?: () => string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * 「第二步：编辑与维护」区段（自 Web `CharacterManagerPage` 抽取）。
 *
 * 区段构成由数据驱动，与 Web 逐行同构：
 * - 结构化情景 → ScenarioEditor（含自带随机事件/章节规划）；
 * - 通用情景 → 章节规划编辑器 + 通用字段编辑器 + 内嵌随机事件；
 * - 角色类 → 通用字段编辑器 + 历战记录 + 当前状态 + 内嵌随机事件。
 * 原生/衍生徽标、保存出口与记录元数据均是宿主插槽。
 */
export function CharacterManagerEditorBody({
  data,
  onFieldChange,
  title,
  badge,
  headerExtra,
  classes,
  renderFieldAddon,
  bottomActions,
  adjudicationLegend = '🎲 内嵌随机事件管理',
  confirmClearHistory,
  currentStateSummaryHint,
  createId,
}: CharacterManagerEditorBodyProps) {
  const template = inferDataCardTemplate(data);
  const isStructuredScenario = template === 'scenario';
  const isScenarioKind = template === 'scenario' || template === 'general-scenario';
  const arenaHistory = asRecord(data.arena_history) as ArenaHistoryLike | null;
  const adjudicationEvents = Array.isArray(data.adjudicationEvents)
    ? (data.adjudicationEvents as AdjudicatorEvent[])
    : [];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">{title}</h2>
        {badge}
      </div>
      {headerExtra}

      {isStructuredScenario ? (
        <ScenarioEditor data={data} onChange={onFieldChange} />
      ) : (
        <div className="space-y-4">
          {template === 'general-scenario' ? (
            <ScenarioBattleStoryPlanEditor data={data} onChange={onFieldChange} />
          ) : null}
          <DataCardFieldEditor
            data={data}
            onFieldChange={onFieldChange}
            classes={classes}
            renderFieldAddon={renderFieldAddon}
          />
        </div>
      )}

      {!isScenarioKind && arenaHistory ? (
        <CharacterManagerArenaHistorySection
          history={arenaHistory}
          onChange={(next) => onFieldChange('arena_history', next)}
          {...(confirmClearHistory ? { confirm: confirmClearHistory } : {})}
          {...(createId ? { createId } : {})}
        />
      ) : null}

      {!isScenarioKind && (
        <CharacterManagerCurrentStateSection
          state={data.current_state as CharacterCurrentState | null | undefined}
          onChange={(next) => onFieldChange('current_state', next)}
          {...(currentStateSummaryHint !== undefined ? { summaryHint: currentStateSummaryHint } : {})}
          {...(createId ? { createId } : {})}
        />
      )}

      {(template === 'general-scenario' || !isScenarioKind) && (
        <fieldset className="border border-gray-300 p-4 rounded-lg mt-4">
          <legend className="text-sm font-semibold px-2 text-gray-600">{adjudicationLegend}</legend>
          <AdjudicatorEditor
            events={adjudicationEvents}
            onEventsChange={(newEvents) => onFieldChange('adjudicationEvents', newEvents)}
          />
        </fieldset>
      )}

      {bottomActions}
    </div>
  );
}
