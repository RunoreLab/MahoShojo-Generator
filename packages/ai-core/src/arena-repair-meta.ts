import { z } from 'zod/v3';

export const STREAM_TRUNCATED_BY_SENSITIVE_MARKER = 'mahoshojo:stream-truncated-sensitive';

const repairTextSchema = z.string().refine(
  (value) => Array.from(value).length <= 2000,
  '单项角色修复文本最多 2000 个 Unicode code point。',
);

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
      '该角色在此次事件中的成长、感悟或变化（1-2 句话）。',
    ),
    currentStateSummary: repairTextSchema.optional().describe(
      '该角色在此次事件结束后的即时状态概述（1-2 句话）。',
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

const stripMarkdown = (text: string): string => text
  .replace(/\*\*(.*?)\*\*/gu, '$1')
  .replace(/`([^`]+)`/gu, '$1')
  .replace(/^\s*[-*]\s+/u, '')
  .trim();

const extractInlineFieldValueFromLines = (lines: string[], labels: string[]): string => {
  const labelPattern = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('|');
  const inlineRegex = new RegExp(`^(?:${labelPattern})\\s*[:：]\\s*(.+)$`, 'iu');
  for (const line of lines) {
    const cleaned = stripMarkdown((line ?? '').trim()).replace(/[*~]/gu, '').trim();
    const matched = cleaned.match(inlineRegex);
    const value = matched?.[1] ? stripMarkdown(matched[1]) : '';
    if (value) return value;
  }
  return '';
};

export const parseArenaBattleReportFromMarkdown = (
  markdown: string,
  mode: string,
): { headline: string; winner: string } | null => {
  const normalized = markdown.replace(/\r\n/gu, '\n');
  const lines = normalized.split('\n');
  const headline = normalized.match(/^#\s*(.+)$/mu)?.[1]?.trim() ?? '';
  const startIndex = lines.findIndex((line) => /^##\s*(?:胜利者|获胜者|优胜者)\s*$/u.test(line.trim()));
  let winner = '';
  if (startIndex >= 0) {
    const sectionLines: string[] = [];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (/^#{1,6}\s*/u.test(line.trim())) break;
      sectionLines.push(line);
    }
    const meaningful = sectionLines.map((line) => line.trim()).filter(Boolean);
    const bulletItems = meaningful.flatMap((line) => {
      const match = line.match(/^\s*[-*]\s+(.+)$/u);
      return match?.[1] ? [stripMarkdown(match[1])] : [];
    });
    winner = bulletItems.length > 0
      ? bulletItems.join('、')
      : meaningful[0]
        ? stripMarkdown(meaningful[0])
        : '';
  } else {
    winner = extractInlineFieldValueFromLines(lines, ['胜利者', '获胜者', '优胜者'])
      || (mode === 'daily' ? extractInlineFieldValueFromLines(lines, ['参与者', '参与角色']) : '');
  }
  return headline && winner ? { headline, winner } : null;
};

export type ArenaBattleReportPrecheckResult =
  | { ok: true; parsed: { headline: string; winner: string } }
  | { ok: false; error: string };

export const precheckArenaBattleReportForRepair = (
  markdown: string,
  mode: string,
): ArenaBattleReportPrecheckResult => {
  const reportMarkdown = typeof markdown === 'string' ? markdown.trim() : '';
  if (!reportMarkdown || reportMarkdown.length < 120) {
    return { ok: false, error: '战报内容过短，无法重做角色更新。' };
  }
  if (reportMarkdown.includes(STREAM_TRUNCATED_BY_SENSITIVE_MARKER)) {
    return { ok: false, error: '战报已因敏感词被截断，无法重做角色更新。' };
  }
  const parsed = parseArenaBattleReportFromMarkdown(reportMarkdown, mode);
  if (!parsed) return { ok: false, error: '无法从战报中解析标题/胜利者，已取消重做。' };
  const headline = parsed.headline.trim();
  const winner = parsed.winner.trim();
  if (!headline || headline === '魔法少女速报' || !winner || winner === '未知') {
    return { ok: false, error: '战报内容不完整（标题/胜利者缺失），已取消重做。' };
  }
  return { ok: true, parsed: { headline, winner } };
};

const compactJsonForPrompt = (value: unknown, maxLength: number): string => {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}\n...（内容过长，已截断）`;
  return text;
};

export const createRepairCombatantMetaPrompt = (input: {
  battleReportMarkdown: string;
  combatants: Array<{ name: string; type: string; currentState?: unknown }>;
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
      stateText ? `\n  当前状态快照：\n  ${stateText.replace(/\n/gu, '\n  ')}` : ''
    }`;
  }).join('\n')}

【战报】
${compactJsonForPrompt(input.battleReportMarkdown, 12000)}
`.trim();
};
