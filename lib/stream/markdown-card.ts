import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';
import { GENERAL_SCENARIO_TEMPLATE_ID } from '@/lib/schemas/general-scenario';

export type ParsedMarkdownCardFields = {
  codename: string | null;
  name: string | null;
  title: string | null;
  headline: string | null;
};

const stripMarkdownDecorations = (raw: string): string => {
  let out = raw.trim();

  out = out.replace(/^[>\-\*\+\s]+/g, '');
  out = out.replace(/`/g, '').trim();

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

  out = out
    .replace(/^[\s"'“”‘’【】\[\]<>《》]+/g, '')
    .replace(/[\s"'“”‘’【】\[\]<>《》]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return out;
};

const clampOneLine = (value: string, max = 80): string => {
  const normalized = stripMarkdownDecorations(value).replace(/\r?\n/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? normalized.slice(0, max) : normalized;
};

const extractHeadlineFromMarkdown = (markdown: string): string | null => {
  const lines = markdown.split(/\r?\n/).map((l) => l.trim());
  for (const line of lines) {
    if (!line) continue;
    const m = line.match(/^#{1,3}\s*(.+)$/);
    if (m?.[1]) {
      const headline = clampOneLine(m[1], 120);
      return headline ? headline : null;
    }
    const fallback = clampOneLine(line, 120);
    return fallback ? fallback : null;
  }
  return null;
};

const matchLineField = (lines: string[], patterns: RegExp[]): string | null => {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const pattern of patterns) {
      const m = trimmed.match(pattern);
      if (!m?.[1]) continue;
      const value = clampOneLine(m[1], 120);
      if (value) return value;
    }
  }
  return null;
};

export function parseMarkdownCardFields(markdown: string | null | undefined): ParsedMarkdownCardFields {
  const normalized = typeof markdown === 'string' ? markdown : '';
  const lines = normalized.split(/\r?\n/).slice(0, 120);

  const codename = matchLineField(lines, [
    /^(?:[-*+]\s*)?(?:#{1,6}\s*)?(?:代号|花名|codename|code\s*name)\s*[:：]\s*(.+)\s*$/i,
  ]);

  const name = matchLineField(lines, [
    /^(?:[-*+]\s*)?(?:#{1,6}\s*)?(?:名字|姓名|真名|名称|name)\s*[:：]\s*(.+)\s*$/i,
  ]);

  const title = matchLineField(lines, [
    /^(?:[-*+]\s*)?(?:#{1,6}\s*)?(?:标题|题名|情景名|情景标题|场景标题|title|scenario\s*title|scene\s*title)\s*[:：]\s*(.+)\s*$/i,
  ]);

  const headline = extractHeadlineFromMarkdown(normalized);

  return {
    codename: codename || null,
    name: name || null,
    title: title || null,
    headline: headline || null,
  };
}

const normalizeFallback = (value: unknown, max = 80): string => {
  if (typeof value !== 'string') return '';
  return clampOneLine(value, max);
};

export function buildGeneralCharacterCardFromMarkdown(options: {
  markdown: string;
  fallbackName?: string | null;
  fallbackCodename?: string | null;
  defaultName: string;
}): { card: { templateId: typeof GENERAL_CHARACTER_TEMPLATE_ID; name: string; content: string; codename?: string }; parsed: ParsedMarkdownCardFields } {
  const parsed = parseMarkdownCardFields(options.markdown);
  const fallbackName = normalizeFallback(options.fallbackName, 60);
  const fallbackCodename = normalizeFallback(options.fallbackCodename, 60);

  const resolvedCodename = parsed.codename || fallbackCodename || null;

  const resolvedName =
    parsed.name ||
    parsed.headline ||
    resolvedCodename ||
    fallbackName ||
    normalizeFallback(options.defaultName, 60) ||
    '未命名角色';

  const card: { templateId: typeof GENERAL_CHARACTER_TEMPLATE_ID; name: string; content: string; codename?: string } = {
    templateId: GENERAL_CHARACTER_TEMPLATE_ID,
    name: resolvedName,
    content: options.markdown,
  };

  if (resolvedCodename) {
    card.codename = resolvedCodename;
  }

  return { card, parsed };
}

export function buildGeneralScenarioCardFromMarkdown(options: {
  markdown: string;
  fallbackTitle?: string | null;
  defaultTitle: string;
}): { card: { templateId: typeof GENERAL_SCENARIO_TEMPLATE_ID; title: string; content: string }; parsed: ParsedMarkdownCardFields } {
  const parsed = parseMarkdownCardFields(options.markdown);
  const fallbackTitle = normalizeFallback(options.fallbackTitle, 80);

  const resolvedTitle =
    parsed.title ||
    parsed.headline ||
    fallbackTitle ||
    normalizeFallback(options.defaultTitle, 80) ||
    '未命名情景';

  return {
    card: {
      templateId: GENERAL_SCENARIO_TEMPLATE_ID,
      title: resolvedTitle,
      content: options.markdown,
    },
    parsed,
  };
}
