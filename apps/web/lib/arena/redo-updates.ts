import { z } from 'zod/v3';

export const STREAM_TRUNCATED_BY_SENSITIVE_MARKER = 'mahoshojo:stream-truncated-sensitive';

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

  return z
    .object({
      impacts: z.array(z.object(itemShape)).describe('逐个角色的更新摘要。'),
    })
    .describe('基于战报，为每位角色生成可写入的更新摘要 JSON。');
};

const repairTextSchema = z.string().refine(
  (value) => Array.from(value).length <= 2000,
  '单项角色修复文本最多 2000 个 Unicode code point。'
);

/**
 * AI 修复通道只生成按 roster index 对齐的内容 patch。这里在 schema 层同时
 * 验证完整覆盖、index 唯一性与名称绑定，避免名称重复或模型乱序造成错写。
 */
export const buildRepairCombatantMetaSchema = (options: {
  combatantNames: string[];
  enableImpactText: boolean;
  enableCurrentState: boolean;
}) => {
  const { combatantNames, enableImpactText, enableCurrentState } = options;
  const itemSchema = z.object({
    combatantIndex: z.number().int().describe('角色在请求 roster 中从 0 开始的 index。'),
    characterName: z.string().describe('该 index 对应的角色名称，必须与请求完全一致。'),
    impact: repairTextSchema.optional().describe(
      '该角色在此次事件中的成长、感悟或变化（1-2 句话）。'
    ),
    currentStateSummary: repairTextSchema.optional().describe(
      '该角色在此次事件结束后的即时状态概述（1-2 句话）。'
    ),
  }).strict();

  return z.object({
    impacts: z.array(itemSchema).length(combatantNames.length),
  }).strict().superRefine((value, context) => {
    const seenIndexes = new Set<number>();
    value.impacts.forEach((impact, arrayIndex) => {
      const combatantIndex = impact.combatantIndex;
      if (combatantIndex < 0 || combatantIndex >= combatantNames.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['impacts', arrayIndex, 'combatantIndex'],
          message: 'combatantIndex 超出 roster 范围。',
        });
        return;
      }
      if (seenIndexes.has(combatantIndex)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['impacts', arrayIndex, 'combatantIndex'],
          message: 'combatantIndex 不得重复。',
        });
      }
      seenIndexes.add(combatantIndex);
      if (impact.characterName !== combatantNames[combatantIndex]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['impacts', arrayIndex, 'characterName'],
          message: 'characterName 与 combatantIndex 对应的 roster 名称不一致。',
        });
      }
      if (enableImpactText !== (typeof impact.impact === 'string')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['impacts', arrayIndex, 'impact'],
          message: enableImpactText ? 'impact 已启用且必须提供。' : 'impact 未启用且不得提供。',
        });
      }
      if (enableCurrentState !== (typeof impact.currentStateSummary === 'string')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['impacts', arrayIndex, 'currentStateSummary'],
          message: enableCurrentState
            ? 'currentStateSummary 已启用且必须提供。'
            : 'currentStateSummary 未启用且不得提供。',
        });
      }
    });
  }).describe('按 roster index 严格对齐的 Arena 角色修复内容 patch。');
};

const stripMarkdown = (text: string): string =>
  text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/, '')
    .trim();

const extractInlineFieldValueFromLines = (
  lines: string[],
  labels: string[]
): string => {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const inlineRegex = new RegExp(`^(?:${labelPattern})\\s*[:：]\\s*(.+)$`, 'i');

  for (const line of lines) {
    const cleaned = stripMarkdown((line ?? '').trim()).replace(/[*~]/g, '').trim();
    if (!cleaned) continue;
    const matched = cleaned.match(inlineRegex);
    if (!matched?.[1]) continue;
    const value = stripMarkdown(matched[1]);
    if (value) return value;
  }

  return '';
};

export const parseBattleReportFromMarkdown = (
  markdown: string,
  mode: string
): { headline: string; winner: string } | null => {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  const headlineMatch = normalized.match(/^#\s*(.+)$/m);
  const headline = headlineMatch?.[1]?.trim() || '';

  const extractSectionLines = (headingRegex: RegExp): string[] | null => {
    const startIndex = lines.findIndex((line) => headingRegex.test(line.trim()));
    if (startIndex === -1) return null;

    const sectionLines: string[] = [];
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^#{1,6}\s*/.test(line.trim())) break;
      sectionLines.push(line);
    }

    return sectionLines;
  };

  let winner = '';
  const winnerSection = extractSectionLines(/^##\s*(?:胜利者|获胜者|优胜者)\s*$/);
  if (winnerSection) {
    const meaningful = winnerSection.map((line) => line.trim()).filter(Boolean);
    const bulletItems = meaningful
      .map((line) => {
        const match = line.match(/^\s*[-*]\s+(.+)$/);
        return match?.[1]?.trim() ?? null;
      })
      .filter((item): item is string => Boolean(item));

    if (bulletItems.length > 0) {
      winner = bulletItems.map(stripMarkdown).join('、');
    } else if (meaningful.length > 0) {
      winner = stripMarkdown(meaningful[0]);
    }
  } else {
    winner =
      extractInlineFieldValueFromLines(lines, ['胜利者', '获胜者', '优胜者']) ||
      (mode === 'daily' ? extractInlineFieldValueFromLines(lines, ['参与者', '参与角色']) : '');
  }

  if (!headline || !winner) return null;
  return { headline, winner };
};

export type RedoBattleReportPrecheckResult =
  | { ok: true; parsed: { headline: string; winner: string } }
  | { ok: false; error: string };

export const precheckBattleReportForRedo = (
  markdown: string,
  mode: string
): RedoBattleReportPrecheckResult => {
  const reportMarkdown = typeof markdown === 'string' ? markdown.trim() : '';
  if (!reportMarkdown || reportMarkdown.length < 120) {
    return { ok: false, error: '战报内容过短，无法重做角色更新。' };
  }

  if (reportMarkdown.includes(STREAM_TRUNCATED_BY_SENSITIVE_MARKER)) {
    return { ok: false, error: '战报已因敏感词被截断，无法重做角色更新。' };
  }

  const parsedReport = parseBattleReportFromMarkdown(reportMarkdown, mode);
  if (!parsedReport) {
    return { ok: false, error: '无法从战报中解析标题/胜利者，已取消重做。' };
  }

  const headline = parsedReport.headline.trim();
  const winner = parsedReport.winner.trim();
  if (!headline || headline === '魔法少女速报' || !winner || winner === '未知') {
    return { ok: false, error: '战报内容不完整（标题/胜利者缺失），已取消重做。' };
  }

  return { ok: true, parsed: { headline, winner } };
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
  const {
    battleReportMarkdown,
    combatants,
    mode,
    winner,
    writeArenaHistory,
    writeCurrentState,
  } = input;

  const enabledFields: string[] = [];
  if (writeArenaHistory) enabledFields.push('impact');
  if (writeCurrentState) enabledFields.push('currentStateSummary');

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
6) 胜利者信息仅作参考：本次战报标注的胜利者为「${winner}」；请确保 impact 与其不矛盾。

【模式】${mode}

【角色列表（供对齐名称用）】
${combatants
  .map((c, i) => {
    const stateText = c.currentState ? compactJsonForPrompt(c.currentState, 700) : '';
    return `- #${i + 1} ${c.name}（${c.type}）${stateText ? `\n  当前状态快照：\n  ${stateText.replace(/\n/g, '\n  ')}` : ''}`;
  })
  .join('\n')}

【战报】
${compactJsonForPrompt(battleReportMarkdown, 12000)}
`.trim();
};

export const createRepairCombatantMetaPrompt = (input: {
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
请根据战报为每位参战角色生成可编辑的“角色元数据修复草稿”。

必须遵守：
1) 只输出与 schema 匹配的 JSON，不输出解释、Markdown 或角色卡。
2) impacts 必须完整覆盖 roster；每个 combatantIndex 从 0 开始且只出现一次。
3) characterName 必须与同一 combatantIndex 的 roster 名称逐字一致；不得按名称猜测 index。
4) 只生成以下字段：${enabledFields.join('、')}。
5) 每项内容不超过 2000 个 Unicode code point，并且只总结战报已经发生的内容。
6) 这是供用户审阅的草稿，不要生成签名、身份字段或完整角色数据。
7) 战报标注的胜利者为「${input.winner}」，生成内容不得与其矛盾。

【模式】${input.mode}

【角色 roster】
${input.combatants.map((combatant, index) => {
  const stateText = combatant.currentState
    ? compactJsonForPrompt(combatant.currentState, 700)
    : '';
  return `- combatantIndex=${index}; characterName=${JSON.stringify(combatant.name)}; type=${combatant.type}${
    stateText ? `\n  当前状态快照：\n  ${stateText.replace(/\n/g, '\n  ')}` : ''
  }`;
}).join('\n')}

【战报】
${compactJsonForPrompt(input.battleReportMarkdown, 12000)}
`.trim();
};
