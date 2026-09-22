import { stripAllStreamMetaComments } from '@/lib/arena/stream-meta';

const DISPLAY_TITLE_MAX_CODE_POINTS = 120;
const HTML_DOCUMENT_PATTERN = /<!doctype\s+html\b|<html(?:\s|>)/i;
const MARKDOWN_HEADING_PATTERN = /^#{1,6}[ \t]+(.+)$/m;
const META_COMMENT_PATTERN = /<!---*\s*(?:MAHOSHOJO_ARENA_META|MAHOSHOJO_META|MAHOSHOJO_STREAM_META)\b([\s\S]*?)-->/gi;

const clampDisplayTitle = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const codePoints = Array.from(collapsed);
  if (codePoints.length <= DISPLAY_TITLE_MAX_CODE_POINTS) return collapsed;
  return `${codePoints.slice(0, DISPLAY_TITLE_MAX_CODE_POINTS - 1).join('')}…`;
};

const decodeBasicEntities = (value: string): string => value.replace(
  /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi,
  (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    if (lower === 'nbsp') return ' ';
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const code = Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  },
);

const pad2 = (value: number): string => String(value).padStart(2, '0');

const formatFallbackTimestamp = (now: Date): string => {
  if (!Number.isFinite(now.getTime())) return '未知时间';
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}`;
};

export const battleReportModeLabel = (mode: string | null | undefined): string | null => {
  if (mode === 'classic') return '经典';
  if (mode === 'kizuna') return '羁绊';
  if (mode === 'daily') return '日常';
  if (mode === 'scenario') return '情景';
  return null;
};

/**
 * 只解析静态 `<title>` 文本，不执行脚本、不读取 `<h1>` 或正文。
 * 脚本/样式里的伪造标题会在清洗阶段被丢弃。
 */
export function extractHtmlDocumentTitle(html: string | null | undefined): string | null {
  if (typeof html !== 'string' || !html) return null;
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, ' ');
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(cleaned);
  if (!match) return null;
  return clampDisplayTitle(decodeBasicEntities(match[1] ?? '')) || null;
}

/** 尽力从机器元数据注释中读取权威 headline；解析失败时返回 null，绝不回退到正文猜测。 */
export function extractMetaHeadlineFromContent(content: string | null | undefined): string | null {
  if (typeof content !== 'string' || !content) return null;
  const pattern = new RegExp(META_COMMENT_PATTERN.source, META_COMMENT_PATTERN.flags);
  let resolved: string | null = null;
  for (const match of content.matchAll(pattern)) {
    const inner = match[1] ?? '';
    const start = inner.indexOf('{');
    const end = inner.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(inner.slice(start, end + 1)) as { report?: { headline?: unknown } };
      const headline = clampDisplayTitle(parsed?.report?.headline);
      if (headline) resolved = headline;
    } catch {
      // 宽松 JSON 交由既有 stream-meta 管线处理；显示标题只做尽力解析。
    }
  }
  return resolved;
}

export type WebDisplayTitleInput = {
  /** 机器元数据中的权威标题（MAHOSHOJO_ARENA_META.report.headline / 数据库 headline）。 */
  headline?: string | null;
  /** 原始输出内容或已归一化的 HTML 文档。 */
  html?: string | null;
  /** 情景名称等上下文，仅用于展示层 fallback。 */
  contextLabel?: string | null;
  now?: Date;
};

/**
 * Web 战报显示标题优先级（仅影响展示/下载命名，不写入权威字段）：
 * 1. 机器元数据 headline（显式传入或内容内注释）
 * 2. 静态 HTML `<title>`
 * 3. 上下文 fallback，例如 `雨夜车站 · Web战报`
 * 4. `Web战报_2026-09-22_0839`
 */
export function resolveWebDisplayTitle(input: WebDisplayTitleInput): string {
  const authoritative = clampDisplayTitle(input.headline);
  if (authoritative) return authoritative;

  const metaHeadline = extractMetaHeadlineFromContent(input.html);
  if (metaHeadline) return metaHeadline;

  const documentTitle = extractHtmlDocumentTitle(input.html);
  if (documentTitle) return documentTitle;

  const context = clampDisplayTitle(input.contextLabel);
  if (context) return `${context} · Web战报`;

  return `Web战报_${formatFallbackTimestamp(input.now ?? new Date())}`;
}

export type BattleReportDisplayTitleInput = {
  headline?: string | null;
  /** 已存正文或预览；只为展示解析，不参与权威裁决。 */
  content?: string | null;
  contextLabel?: string | null;
  mode?: string | null;
  now?: Date;
};

const extractStrictMarkdownHeading = (text: string): string | null => {
  if (!text) return null;
  const match = MARKDOWN_HEADING_PATTERN.exec(text);
  if (!match) return null;
  return clampDisplayTitle(match[1]) || null;
};

/**
 * 统一的战报显示标题：
 * headline →（Web 内容走 resolveWebDisplayTitle；Markdown 取严格一级标题）→ 上下文 fallback → 时间戳兜底。
 * 权威 winner/headline 仍只来自机器元数据，本函数不回写任何数据库字段。
 */
export function resolveBattleReportDisplayTitle(input: BattleReportDisplayTitleInput): string {
  const headline = clampDisplayTitle(input.headline);
  if (headline) return headline;

  const content = typeof input.content === 'string' ? input.content : '';
  if (content.trim()) {
    if (HTML_DOCUMENT_PATTERN.test(content)) {
      return resolveWebDisplayTitle({
        html: content,
        contextLabel: input.contextLabel,
        now: input.now,
      });
    }
    const markdownHeading = extractStrictMarkdownHeading(stripAllStreamMetaComments(content));
    if (markdownHeading) return markdownHeading;
  }

  const context = clampDisplayTitle(input.contextLabel);
  const modeLabel = battleReportModeLabel(input.mode);
  const kindLabel = modeLabel ? `${modeLabel}战报` : null;
  if (context || kindLabel) {
    return clampDisplayTitle([context, kindLabel].filter(Boolean).join(' · '));
  }

  return `战报_${formatFallbackTimestamp(input.now ?? new Date())}`;
}
