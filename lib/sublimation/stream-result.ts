import { buildGeneralCharacterCardFromMarkdown } from '@/lib/stream/markdown-card';
import {
  applySublimationArenaHistoryStrategy,
  buildSublimationHistoryEntry,
} from '@/lib/sublimation/arena-history';

type SublimationEvent = {
  title: string;
  impact: string;
};

type BuildStreamedSublimationResultCardInput = {
  markdown: string;
  originalCharacterData: Record<string, unknown> | null | undefined;
  fallbackName?: string | null;
  defaultName: string;
  writeArenaHistory: boolean;
  retentionStrategy: unknown;
  finalUserGuidance?: string | null;
  hasNarrativeHistory?: boolean;
  hasQuestionnaireLore?: boolean;
  hasNonNativeQuestionnaireLore?: boolean;
  questionnaireSelectionCount?: number;
  isNative?: boolean;
  nowISO?: string;
  createWorldLineId?: () => string;
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const stripMarkdownDecorations = (raw: string): string => {
  let out = raw.trim();
  out = out.replace(/^[>\-\*\+\s]+/g, '').replace(/`/g, '').trim();

  for (let i = 0; i < 3; i += 1) {
    const prev = out;
    out = out
      .replace(/^\*\*(.+)\*\*$/u, '$1')
      .replace(/^__(.+)__$/u, '$1')
      .replace(/^\*(.+)\*$/u, '$1')
      .replace(/^_(.+)_$/u, '$1')
      .replace(/^~~(.+)~~$/u, '$1')
      .trim();
    if (out === prev) break;
  }

  return out
    .replace(/^[\s"'“”‘’【】\[\]<>《》]+/g, '')
    .replace(/[\s"'“”‘’【】\[\]<>《》]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const clampOneLine = (value: string, max = 120): string => {
  const normalized = stripMarkdownDecorations(value).replace(/\r?\n/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? normalized.slice(0, max) : normalized;
};

const findSublimationSectionLines = (markdown: string): string[] => {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? '';
    const headingMatch = line.match(/^(#{1,6})\s*(.+)$/);
    if (!headingMatch?.[1] || !headingMatch[2]) continue;

    const headingLevel = headingMatch[1].length;
    const headingText = stripMarkdownDecorations(headingMatch[2]);
    if (!/(^|[\s:：-])升华事件($|[\s:：-])|sublimation\s*event/i.test(headingText)) {
      continue;
    }

    const sectionLines: string[] = [];
    for (let cursor = i + 1; cursor < lines.length; cursor += 1) {
      const current = lines[cursor] ?? '';
      const nextHeading = current.trim().match(/^(#{1,6})\s+/);
      if (nextHeading?.[1] && nextHeading[1].length <= headingLevel) break;
      sectionLines.push(current);
    }
    return sectionLines;
  }
  return [];
};

const extractLabeledInlineValue = (lines: string[], labels: string[]): string | null => {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(
    `^(?:[-*+]\\s*)?(?:#{1,6}\\s*)?(?:${escaped.join('|')})\\s*[:：]\\s*(.+)\\s*$`,
    'i',
  );
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (!match?.[1]) continue;
    const value = clampOneLine(match[1], 160);
    if (value) return value;
  }
  return null;
};

const extractLabeledBlockValue = (lines: string[], labels: string[]): string | null => {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const headingOnlyPattern = new RegExp(
    `^(?:[-*+]\\s*)?(?:#{1,6}\\s*)?(?:${escaped.join('|')})\\s*$`,
    'i',
  );

  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i]?.trim() ?? '';
    if (!headingOnlyPattern.test(current)) continue;
    for (let cursor = i + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor]?.trim() ?? '';
      if (!candidate) continue;
      if (/^#{1,6}\s+/.test(candidate)) break;
      const value = clampOneLine(candidate, 160);
      if (value) return value;
    }
  }

  return null;
};

const extractSectionSummary = (lines: string[]): string | null => {
  const candidates: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#{1,6}\s+/.test(line)) continue;
    if (/^(?:[-*+]\s*)?(?:标题|事件标题|title|影响|变化|impact|effect)\s*[:：]/i.test(line)) continue;
    const cleaned = clampOneLine(line, 200);
    if (cleaned) candidates.push(cleaned);
  }
  if (candidates.length === 0) return null;
  return candidates.join(' ').slice(0, 200);
};

const extractHeadingStyleEvent = (
  lines: string[],
): { title: string | null; impact: string | null } => {
  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i]?.trim() ?? '';
    const headingMatch = current.match(/^#{3,6}\s*(.+)$/);
    if (!headingMatch?.[1]) continue;

    const title = clampOneLine(headingMatch[1], 160) || null;
    if (!title) continue;

    const impactLines: string[] = [];
    for (let cursor = i + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor]?.trim() ?? '';
      if (!candidate) continue;
      if (/^#{1,6}\s+/.test(candidate)) break;
      const cleaned = clampOneLine(candidate, 200);
      if (cleaned) impactLines.push(cleaned);
    }

    return {
      title,
      impact: impactLines.length > 0 ? impactLines.join(' ').slice(0, 200) : null,
    };
  }

  return { title: null, impact: null };
};

export const extractSublimationEventFromMarkdown = (
  markdown: string,
  fallbackName: string | null | undefined,
): SublimationEvent => {
  const sectionLines = findSublimationSectionLines(markdown);
  const headingStyle = extractHeadingStyleEvent(sectionLines);
  const title =
    headingStyle.title ??
    extractLabeledInlineValue(sectionLines, ['事件标题', '升华标题', '标题', 'title']) ??
    extractLabeledBlockValue(sectionLines, ['事件标题', '升华标题', '标题', 'title']);
  const impact =
    headingStyle.impact ??
    extractLabeledInlineValue(sectionLines, ['影响', '变化', '结果', 'impact', 'effect']) ??
    extractLabeledBlockValue(sectionLines, ['影响', '变化', '结果', 'impact', 'effect']) ??
    extractSectionSummary(sectionLines);

  const normalizedFallbackName = clampOneLine(fallbackName ?? '', 60);
  const fallbackTitle = normalizedFallbackName ? `${normalizedFallbackName}的升华` : '升华事件';
  const fallbackImpact = '角色在这次升华中完成了新的成长。';

  return {
    title: title ?? fallbackTitle,
    impact: impact ?? fallbackImpact,
  };
};

export const buildStreamedSublimationResultCard = (input: BuildStreamedSublimationResultCardInput) => {
  const source = toRecord(input.originalCharacterData);
  const nowISO = input.nowISO ?? new Date().toISOString();
  const normalizedGuidance = typeof input.finalUserGuidance === 'string' ? input.finalUserGuidance.trim() : '';
  const finalUserGuidance = normalizedGuidance || null;

  const sourceCodename =
    typeof source.codename === 'string'
      ? clampOneLine(source.codename, 60)
      : null;
  const sourceName =
    typeof source.name === 'string'
      ? clampOneLine(source.name, 60)
      : null;
  const fallbackName = typeof input.fallbackName === 'string' ? input.fallbackName : sourceName ?? sourceCodename;

  const { card } = buildGeneralCharacterCardFromMarkdown({
    markdown: input.markdown,
    fallbackName,
    fallbackCodename: sourceCodename,
    defaultName: input.defaultName,
  });

  const result: Record<string, unknown> = cloneJson(card);
  const event = extractSublimationEventFromMarkdown(input.markdown, fallbackName);
  const questionnaireSelectionCount =
    typeof input.questionnaireSelectionCount === 'number' && Number.isFinite(input.questionnaireSelectionCount)
      ? Math.max(0, Math.floor(input.questionnaireSelectionCount))
      : 0;

  if (input.writeArenaHistory) {
    const participantsName =
      typeof result.codename === 'string'
        ? result.codename
        : typeof result.name === 'string'
          ? result.name
          : null;

    const historyEntry = buildSublimationHistoryEntry({
      title: event.title,
      impact: event.impact,
      participantsName,
      finalUserGuidance,
      hasQuestionnaireLore: Boolean(input.hasQuestionnaireLore),
      questionnaireSelectionCount,
      nonNativeDataInvolved:
        !Boolean(input.isNative) ||
        Boolean(finalUserGuidance) ||
        Boolean(input.hasNarrativeHistory) ||
        Boolean(input.hasNonNativeQuestionnaireLore),
    });

    result.arena_history = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: source.arena_history,
      strategy: input.retentionStrategy,
      newEntry: historyEntry,
      nowISO,
      createWorldLineId: input.createWorldLineId,
    });
  } else if (typeof source.arena_history !== 'undefined' && source.arena_history !== null) {
    result.arena_history = cloneJson(source.arena_history);
  } else {
    delete result.arena_history;
  }

  if (typeof source.current_state !== 'undefined' && source.current_state !== null) {
    result.current_state = cloneJson(source.current_state);
  } else {
    delete result.current_state;
  }

  delete result.signature;
  return result;
};

export type { BuildStreamedSublimationResultCardInput };
