import type { BattleStoreState } from '@/components/arena/types';

type SummaryInput = Pick<
  BattleStoreState,
  | 'battleMode'
  | 'scenario'
  | 'storyLength'
  | 'selectedLanguage'
  | 'settings'
  | 'auxScenarios'
  | 'selectedQuestionnaires'
  | 'adjudicationEvents'
>;

export type BattleLiteInheritedSummary = {
  inheritedSettings: string[];
  hiddenContext: string[];
  hasHiddenContext: boolean;
};

const formatArenaHistoryRead = (settings: SummaryInput['settings']): string => {
  if (!settings.readArenaHistory) return '历战读取：关闭';
  if (settings.isArenaHistoryUnlimited) return '历战读取：开启（不限）';
  return `历战读取：开启（${Math.max(1, settings.readArenaHistoryLimit)} 条）`;
};

const formatNarrativeHistory = (settings: SummaryInput['settings']): string => {
  if (!settings.readNarrativeHistory) {
    return settings.writeNarrativeHistory ? '叙事历史：关闭读取 / 写回开启' : '叙事历史：关闭';
  }

  const readPart = settings.isNarrativeHistoryUnlimited
    ? '开启（不限）'
    : `开启（${Math.max(1, settings.readNarrativeHistoryLimit)} 条）`;
  const writePart = settings.writeNarrativeHistory ? '写回开启' : '不写回';

  return `叙事历史：${readPart}/ ${writePart}`;
};

export const buildBattleLiteInheritedSummary = (input: SummaryInput): BattleLiteInheritedSummary => {
  const hiddenContext: string[] = [];
  const shouldCountAuxScenarios = input.battleMode === 'scenario' && Boolean(input.scenario?.content);

  if (shouldCountAuxScenarios && input.auxScenarios.length > 0) hiddenContext.push(`辅助情景 ${input.auxScenarios.length} 个`);
  if (input.selectedQuestionnaires.length > 0) hiddenContext.push(`问卷 ${input.selectedQuestionnaires.length} 张`);
  if (input.adjudicationEvents.length > 0) hiddenContext.push(`判定事件 ${input.adjudicationEvents.length} 条`);

  return {
    inheritedSettings: [
      `长度：${input.storyLength}`,
      `语言：${input.selectedLanguage}`,
      formatArenaHistoryRead(input.settings),
      `当前状态读取：${input.settings.readCurrentState ? '开启' : '关闭'}`,
      `当前状态写回：${input.settings.writeCurrentState ? '开启' : '关闭'}`,
      formatNarrativeHistory(input.settings),
    ],
    hiddenContext,
    hasHiddenContext: hiddenContext.length > 0,
  };
};
