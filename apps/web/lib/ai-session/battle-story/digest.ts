import { stripStreamUpdateMetaComment } from '@/lib/arena/stream-meta';
import type {
  BattleStoryDeterministicDigest,
  BattleStoryImpactDigestItem,
} from '@/lib/ai-session/battle-story/types';

const DEFAULT_BODY_EXCERPT_CHARS = 240;
const DEFAULT_MAX_IMPACT_ITEMS = 8;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const normalizeText = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const normalizeNameToken = (value: string): string => {
  return value.trim().replace(/\s+/g, '').toLowerCase();
};

const truncateText = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
};

const stripInlineMarkdown = (input: string): string => {
  return input
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[`*_~>#]/g, ' ')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const readMarkdownTitle = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingMatch = line.match(/^#{1,6}\s*(.+)$/);
    if (headingMatch?.[1]) return headingMatch[1].trim();
    break;
  }
  return '';
};

const extractBodyText = (markdown: string): string => {
  const stripped = stripStreamUpdateMetaComment(markdown)?.strippedMarkdown ?? markdown;
  const lines = stripped.split(/\r?\n/);
  const bodyLines: string[] = [];
  let seenPrimaryTitle = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (bodyLines.length > 0) bodyLines.push('');
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      if (!seenPrimaryTitle) {
        seenPrimaryTitle = true;
        continue;
      }
      break;
    }

    bodyLines.push(line);
  }

  const candidate = stripInlineMarkdown(bodyLines.join('\n'));
  if (candidate) return candidate;

  return stripInlineMarkdown(stripped);
};

const readNestedText = (root: unknown, path: string[]): string => {
  let cursor: unknown = root;
  for (const key of path) {
    if (!isRecord(cursor)) return '';
    cursor = cursor[key];
  }
  return normalizeText(cursor);
};

const normalizeImpactDigest = (
  impacts: unknown,
  rosterOrder?: string[],
  maxItems = DEFAULT_MAX_IMPACT_ITEMS
): BattleStoryImpactDigestItem[] | undefined => {
  if (!Array.isArray(impacts) || impacts.length === 0) return undefined;

  const deduped = new Map<string, BattleStoryImpactDigestItem>();
  for (const raw of impacts) {
    if (!isRecord(raw)) continue;
    const characterName = normalizeText(raw.characterName ?? raw.name ?? raw.character ?? raw.character_name);
    if (!characterName) continue;

    const token = normalizeNameToken(characterName);
    const previous = deduped.get(token);
    const next: BattleStoryImpactDigestItem = {
      characterName,
      ...(normalizeText(raw.impact) ? { impact: normalizeText(raw.impact) } : {}),
      ...(normalizeText(raw.currentStateSummary ?? raw.current_state_summary)
        ? { currentStateSummary: normalizeText(raw.currentStateSummary ?? raw.current_state_summary) }
        : {}),
    };

    deduped.set(token, {
      characterName: previous?.characterName ?? next.characterName,
      impact: next.impact ?? previous?.impact,
      currentStateSummary: next.currentStateSummary ?? previous?.currentStateSummary,
    });
  }

  let items = Array.from(deduped.values());
  if (items.length === 0) return undefined;

  if (Array.isArray(rosterOrder) && rosterOrder.length > 0) {
    const order = new Map(rosterOrder.map((name, index) => [normalizeNameToken(name), index]));
    items = items.sort((left, right) => {
      const leftIndex = order.get(normalizeNameToken(left.characterName));
      const rightIndex = order.get(normalizeNameToken(right.characterName));
      const safeLeft = typeof leftIndex === 'number' ? leftIndex : Number.MAX_SAFE_INTEGER;
      const safeRight = typeof rightIndex === 'number' ? rightIndex : Number.MAX_SAFE_INTEGER;
      if (safeLeft !== safeRight) return safeLeft - safeRight;
      return left.characterName.localeCompare(right.characterName, 'zh-Hans-CN');
    });
  }

  return items.slice(0, maxItems);
};

export const buildBattleStoryDeterministicDigest = (input: {
  markdown: string;
  reportJson?: Record<string, unknown> | null;
  impacts?: unknown;
  rosterOrder?: string[];
  chapterIndex?: number;
  bodyExcerptMaxChars?: number;
  maxImpactItems?: number;
}): BattleStoryDeterministicDigest => {
  const reportJson = isRecord(input.reportJson) ? input.reportJson : {};
  const chapterTitle =
    readMarkdownTitle(input.markdown) ||
    readNestedText(reportJson, ['headline']) ||
    readNestedText(reportJson, ['report', 'headline']) ||
    `第 ${Math.max(1, Math.floor(input.chapterIndex ?? 1))} 章`;

  const winner =
    readNestedText(reportJson, ['officialReport', 'winner']) ||
    readNestedText(reportJson, ['report', 'winner']) ||
    undefined;

  const officialConclusion =
    readNestedText(reportJson, ['officialReport', 'conclusion']) ||
    readNestedText(reportJson, ['officialConclusion']) ||
    undefined;

  const bodyText = extractBodyText(input.markdown);
  const bodyExcerpt = bodyText
    ? truncateText(bodyText, Math.max(80, Math.floor(input.bodyExcerptMaxChars ?? DEFAULT_BODY_EXCERPT_CHARS)))
    : undefined;

  const impactDigest = normalizeImpactDigest(
    input.impacts,
    input.rosterOrder,
    Math.max(1, Math.floor(input.maxImpactItems ?? DEFAULT_MAX_IMPACT_ITEMS))
  );

  return {
    chapterTitle,
    ...(winner ? { winner } : {}),
    ...(officialConclusion ? { officialConclusion } : {}),
    ...(bodyExcerpt ? { bodyExcerpt } : {}),
    ...(impactDigest ? { impactDigest } : {}),
  };
};
