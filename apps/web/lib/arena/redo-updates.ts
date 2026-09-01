import { z } from 'zod/v3';

export {
  STREAM_TRUNCATED_BY_SENSITIVE_MARKER,
  buildRepairCombatantMetaSchema,
  createRepairCombatantMetaPrompt,
  parseArenaBattleReportFromMarkdown as parseBattleReportFromMarkdown,
  precheckArenaBattleReportForRepair as precheckBattleReportForRedo,
  type ArenaBattleReportPrecheckResult as RedoBattleReportPrecheckResult,
} from '@mahoshojo/ai-core/arena-repair-meta';

export const buildRedoCombatantUpdatesSchema = (options: {
  enableImpactText: boolean;
  enableCurrentState: boolean;
}) => {
  const { enableImpactText, enableCurrentState } = options;
  const itemShape: Record<string, z.ZodTypeAny> = {
    characterName: z.string().describe('参与者的代号或名称，必须与角色列表中的名称完全一致。'),
  };
  if (enableImpactText) {
    itemShape.impact = z
      .string()
      .describe('该角色在此次事件中的成长、感悟或变化（1-2 句话，避免空泛）。');
  }
  if (enableCurrentState) {
    itemShape.currentStateSummary = z
      .string()
      .describe('该角色在本次事件结束后的即时状态概述（1-2 句话，描述身体/关系/心情/想法等）。');
  }
  return z.object({
    impacts: z.array(z.object(itemShape)).describe('逐个角色的更新摘要。'),
  }).describe('基于战报，为每位角色生成可写入的更新摘要 JSON。');
};

const compactJsonForPrompt = (value: unknown, maxLen = 1400): string => {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen)}\n...（内容过长，已截断）`;
  }
  return text;
};

export const createRedoCombatantUpdatesPrompt = (input: {
  battleReportMarkdown: string;
  combatants: Array<{
    name: string;
    type: string;
    currentState?: unknown;
  }>;
  mode: string;
  winner: string;
  writeArenaHistory: boolean;
  writeCurrentState: boolean;
}): string => {
  const enabledFields: string[] = [];
  if (input.writeArenaHistory) enabledFields.push('impact');
  if (input.writeCurrentState) enabledFields.push('currentStateSummary');

  return `
请你根据战报内容，为每位角色生成“角色更新 JSON”，用于写入：
- 历战记录（impact）
- 当前状态（currentStateSummary）

必须遵守：
1) 只输出与 schema 匹配的 JSON，不要输出任何解释、Markdown 或多余文字。
2) impacts 数组必须覆盖每位参战角色，且每位角色只出现一次。
3) characterName 必须与角色列表中的 name 完全一致（包含代号/称呼），禁止自造名字或改写名字。
4) 只生成以下字段：${enabledFields.join('、') || '（本次未开启任何可写入字段）'}。
5) 内容应具体、可落库、避免空泛；不要引入战报中没有出现的新内容。
6) 胜利者信息仅作参考：本次战报标注的胜利者为「${input.winner}」；请确保 impact 与其不矛盾。

【模式】${input.mode}

【角色列表（供对齐名称用）】
${input.combatants.map((combatant, index) => {
  const stateText = combatant.currentState
    ? compactJsonForPrompt(combatant.currentState, 700)
    : '';
  return `- #${index + 1} ${combatant.name}（${combatant.type}）${
    stateText
      ? `\n  当前状态快照：\n  ${stateText.replace(/\n/g, '\n  ')}`
      : ''
  }`;
}).join('\n')}

【战报】
${compactJsonForPrompt(input.battleReportMarkdown, 12000)}
`.trim();
};
