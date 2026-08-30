import { z } from 'zod/v3';

import { repairNormalizeValidate } from '@/lib/repair-pipeline';

export const STREAM_UPDATE_META_MARKERS = [
  'MAHOSHOJO_ARENA_META',
  'MAHOSHOJO_META',
  'MAHOSHOJO_STREAM_META',
] as const;

export const STREAM_TELEMETRY_META_MARKER = 'MAHOSHOJO_TELEMETRY_META' as const;

const META_MARKERS = [
  ...STREAM_UPDATE_META_MARKERS,
  STREAM_TELEMETRY_META_MARKER,
] as const;

export type StreamUpdateMetaStartKind = 'comment' | 'loose';

export type StreamUpdateMetaStartHit = {
  index: number;
  kind: StreamUpdateMetaStartKind;
  marker: (typeof STREAM_UPDATE_META_MARKERS)[number];
};

const STREAM_UPDATE_META_COMMENT_START_RE = new RegExp(
  `<!---*\\s*(${STREAM_UPDATE_META_MARKERS.join('|')})\\b`,
  'i'
);

const STREAM_UPDATE_META_LOOSE_START_RE = new RegExp(
  `(^|\\n)\\s*(?:---+\\s*)?(${STREAM_UPDATE_META_MARKERS.join('|')})(?=\\s*[:=\\[{]|\\s*$)`,
  'im'
);

export function findStreamUpdateMetaStart(input: string): StreamUpdateMetaStartHit | null {
  if (typeof input !== 'string' || !input) return null;

  const commentMatch = STREAM_UPDATE_META_COMMENT_START_RE.exec(input);
  const looseMatch = STREAM_UPDATE_META_LOOSE_START_RE.exec(input);

  const commentIndex = commentMatch && typeof commentMatch.index === 'number' ? commentMatch.index : null;
  const looseIndex =
    looseMatch && typeof looseMatch.index === 'number'
      ? (() => {
          const matched = looseMatch[0] || '';
          let offset = 0;
          while (offset < matched.length && /\s/.test(matched[offset]!)) {
            offset += 1;
          }
          return looseMatch.index + offset;
        })()
      : null;

  if (commentIndex == null && looseIndex == null) return null;

  if (commentIndex != null && (looseIndex == null || commentIndex <= looseIndex)) {
    const marker = (commentMatch?.[1] || 'MAHOSHOJO_ARENA_META') as StreamUpdateMetaStartHit['marker'];
    return { index: commentIndex, kind: 'comment', marker };
  }

  const marker = (looseMatch?.[2] || 'MAHOSHOJO_ARENA_META') as StreamUpdateMetaStartHit['marker'];
  return { index: looseIndex ?? 0, kind: 'loose', marker };
}

export const StreamUpdateMetaSchema = z
  .object({
    version: z.number().int().min(1).optional(),
    report: z
      .object({
        headline: z.string().optional(),
        winner: z.string().optional(),
      })
      .optional(),
    impacts: z
      .array(
        z
          .object({
            characterName: z.string().optional(),
            name: z.string().optional(),
            character: z.string().optional(),
            character_name: z.string().optional(),
            characterNameZh: z.string().optional(),
            impact: z.string().optional(),
            currentStateSummary: z.string().optional(),
            current_state_summary: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export type StreamUpdateMeta = z.infer<typeof StreamUpdateMetaSchema>;

export const StreamTelemetryMetaSchema = z
  .object({
    version: z.number().int().min(1).optional(),
    aiModel: z.string().optional(),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative().nullable().optional(),
        completionTokens: z.number().int().nonnegative().nullable().optional(),
        reasoningTokens: z.number().int().nonnegative().nullable().optional(),
        totalTokens: z.number().int().nonnegative().nullable().optional(),
        cachedTokens: z.number().int().nonnegative().nullable().optional(),
      })
      .passthrough()
      .optional(),
    narrativeHistoryReadCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type StreamTelemetryMeta = z.infer<typeof StreamTelemetryMetaSchema>;

export interface StreamUpdateImpact {
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
}

export type NormalizedStreamUpdateMeta = Omit<StreamUpdateMeta, 'impacts'> & {
  impacts?: StreamUpdateImpact[];
};

export interface ExtractedStreamMeta {
  meta: NormalizedStreamUpdateMeta;
  rawComment: string;
  strippedMarkdown: string;
}

export interface NormalizedStreamTelemetryMeta {
  aiModel?: string;
  usage?: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    reasoningTokens?: number | null;
    totalTokens?: number | null;
    cachedTokens?: number | null;
    [key: string]: unknown;
  };
  narrativeHistoryReadCount?: number;
  [key: string]: unknown;
}

export interface ExtractedStreamTelemetryMeta {
  meta: NormalizedStreamTelemetryMeta;
  rawComment: string;
  strippedMarkdown: string;
}

export interface StrippedStreamMetaComment {
  rawComment: string;
  strippedMarkdown: string;
  marker: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const escapeRegExp = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeJsonishText = (input: string): string => {
  const normalized = input
    // 常见的“中文引号/弯引号”修复：jsonrepair 不会处理它们
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // 统一 BOM / 零宽字符
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '');

  // 常见“Python-ish”字面量：True/False/None（仅在字符串外替换）
  // 以及：流式生成中常见的“省略号占位符”（……/…/...），避免打断 JSON 修复流程
  // 注意：这里不做 eval，只做最小必要的词法替换。
  let out = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (quote) {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }

    // “……/…/...”：常见于模型在数组里用省略号表示“中间还有内容”
    // 用 null 替换，后续在 postProcess 中过滤掉非对象 impacts，避免 schema 校验失败。
    if (ch === '…') {
      let j = i;
      while (j < normalized.length && normalized[j] === '…') j++;
      out += 'null';
      i = j - 1;
      continue;
    }
    if (ch === '.' && normalized[i + 1] === '.' && normalized[i + 2] === '.') {
      let j = i;
      while (j < normalized.length && normalized[j] === '.') j++;
      out += 'null';
      i = j - 1;
      continue;
    }

    if (ch === 'T' || ch === 'F' || ch === 'N') {
      const rest = normalized.slice(i);
      const match = rest.match(/^(True|False|None)\b/);
      if (match) {
        out += match[1] === 'True' ? 'true' : match[1] === 'False' ? 'false' : 'null';
        i += match[1].length - 1;
        continue;
      }
    }

    out += ch;
  }

  return out;
};

type StreamMetaHit = { start: number; end: number; inner: string; marker: string };

const stripPossibleLeadingMarkerNoise = (inner: string) => inner.trimStart().replace(/^[-–—]+\s*/g, '');

const matchMarkerAtStart = (input: string, markers: readonly string[]) => {
  const head = stripPossibleLeadingMarkerNoise(input).slice(0, 96);
  for (const marker of markers) {
    const re = new RegExp(`^${escapeRegExp(marker)}(?=\\s*[:=\\[{]|\\s*$)`, 'i');
    if (re.test(head)) return marker;
  }
  return null;
};

const findJsonishSpan = (text: string, searchFrom = 0): { start: number; end: number } | null => {
  const firstObj = text.indexOf('{', searchFrom);
  const firstArr = text.indexOf('[', searchFrom);
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return null;

  const stack: string[] = [text[start] === '{' ? '}' : ']'];
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && ch === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) return { start, end: i };
      }
    }
  }

  return null;
};

const findLastHtmlCommentWithMarker = (
  markdown: string,
  markers: readonly string[] = META_MARKERS
): StreamMetaHit | null => {
  const MAX_TAIL_CHARS = 120_000;
  const tailStart = Math.max(0, markdown.length - MAX_TAIL_CHARS);
  const haystack = tailStart > 0 ? markdown.slice(tailStart) : markdown;

  let searchEnd = haystack.lastIndexOf('-->');
  while (searchEnd !== -1) {
    const start = haystack.lastIndexOf('<!--', searchEnd);
    if (start === -1) return null;
    const end = searchEnd + 3;
    const inner = haystack.slice(start + 4, searchEnd);
    const marker = matchMarkerAtStart(inner, markers);
    if (marker) {
      return { start: start + tailStart, end: end + tailStart, inner, marker };
    }
    searchEnd = haystack.lastIndexOf('-->', start - 1);
  }
  return null;
};

type UnclosedCommentHit = { start: number; marker: string };

const findLastUnclosedHtmlCommentStartWithMarker = (
  markdown: string,
  markers: readonly string[] = META_MARKERS
): UnclosedCommentHit | null => {
  const MAX_TAIL_CHARS = 120_000;
  const tailStart = Math.max(0, markdown.length - MAX_TAIL_CHARS);
  const haystack = tailStart > 0 ? markdown.slice(tailStart) : markdown;

  const markerAlt = markers.map(escapeRegExp).join('|');
  const re = new RegExp(`<!---*\\s*(${markerAlt})\\b`, 'gi');

  let last: { index: number; marker: string } | null = null;
  for (const match of haystack.matchAll(re)) {
    if (typeof match.index !== 'number') continue;
    const marker = match[1];
    if (!marker) continue;
    last = { index: match.index, marker };
  }
  if (!last) return null;

  return { start: tailStart + last.index, marker: last.marker };
};

const findLastLooseMarkerBlock = (
  markdown: string,
  markers: readonly string[] = META_MARKERS
): StreamMetaHit | null => {
  const MAX_TAIL_CHARS = 120_000;
  const tailStart = Math.max(0, markdown.length - MAX_TAIL_CHARS);
  const haystack = tailStart > 0 ? markdown.slice(tailStart) : markdown;

  const markerAlt = markers.map(escapeRegExp).join('|');
  const re = new RegExp(`(^|\\n)\\s*(?:---+\\s*)?(${markerAlt})(?=\\s*[:=\\[{]|\\s*$)`, 'gim');

  let last: { index: number; marker: string; matchText: string } | null = null;
  for (const match of haystack.matchAll(re)) {
    if (typeof match.index !== 'number') continue;
    const marker = match[2];
    if (!marker) continue;
    last = { index: match.index, marker, matchText: match[0] };
  }
  if (!last) return null;

  const blockStartInHaystack = last.index + (last.matchText.startsWith('\n') ? 1 : 0);
  const afterMarkerInHaystack = last.index + last.matchText.length;

  const span = findJsonishSpan(haystack, afterMarkerInHaystack);
  if (!span) return null;

  const start = blockStartInHaystack + tailStart;
  const end = span.end + 1 + tailStart;
  const inner = markdown.slice(start, end);
  return { start, end, inner, marker: last.marker };
};

const findLastStreamMetaBlock = (
  markdown: string,
  markers: readonly string[] = META_MARKERS
): StreamMetaHit | null => {
  const commentHit = findLastHtmlCommentWithMarker(markdown, markers);
  const looseHit = findLastLooseMarkerBlock(markdown, markers);
  if (!commentHit) return looseHit;
  if (!looseHit) return commentHit;
  return commentHit.start >= looseHit.start ? commentHit : looseHit;
};

export function stripStreamUpdateMetaComment(markdown: string): StrippedStreamMetaComment | null {
  if (typeof markdown !== 'string' || !markdown.trim()) return null;
  const hit = findLastStreamMetaBlock(markdown);
  if (!hit) {
    const openHit = findLastUnclosedHtmlCommentStartWithMarker(markdown, META_MARKERS);
    if (!openHit) return null;
    const strippedMarkdown = markdown.slice(0, openHit.start).trimEnd();
    return {
      rawComment: markdown.slice(openHit.start),
      strippedMarkdown,
      marker: openHit.marker,
    };
  }
  const strippedMarkdown = (markdown.slice(0, hit.start) + markdown.slice(hit.end)).trimEnd();
  return {
    rawComment: markdown.slice(hit.start, hit.end),
    strippedMarkdown,
    marker: hit.marker,
  };
}

export function stripAllStreamMetaComments(markdown: string): string {
  if (typeof markdown !== 'string' || !markdown) return '';

  let current = markdown;
  while (true) {
    const stripped = stripStreamUpdateMetaComment(current);
    if (!stripped) return current;
    current = stripped.strippedMarkdown;
  }
}

const extractBestJsonCandidate = (commentInner: string): string => {
  const text = normalizeJsonishText(commentInner).trim();

  // 先用括号配对法，尽量精准定位 JSON 边界，避免“后续正文出现括号”导致截断/误扩张
  const span = findJsonishSpan(text, 0);
  if (span) return text.slice(span.start, span.end + 1).trim();

  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);

  const lastObj = text.lastIndexOf('}');
  const lastArr = text.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);

  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim();
  }

  // 结尾括号缺失时，尽量只截取从 “{ / [” 开始的部分交给 jsonrepair 补全
  if (start !== -1) return text.slice(start).trim();

  return text;
};

const sanitizeMeta = (meta: StreamUpdateMeta): NormalizedStreamUpdateMeta => {
  const out: NormalizedStreamUpdateMeta = { ...(meta as any) };

  if (out.report != null) {
    if (!isRecord(out.report)) {
      delete out.report;
    } else {
      const headlineRaw = out.report.headline;
      const winnerRaw = out.report.winner;
      const headline = typeof headlineRaw === 'string' ? headlineRaw.trim() : undefined;
      const winner = typeof winnerRaw === 'string' ? winnerRaw.trim() : undefined;
      const normalizedReport: NonNullable<StreamUpdateMeta['report']> = {
        ...(headline ? { headline } : {}),
        ...(winner ? { winner } : {}),
      };
      if (Object.keys(normalizedReport).length === 0) delete out.report;
      else out.report = normalizedReport;
    }
  }

  if (Array.isArray(out.impacts)) {
    const byName = new Map<string, StreamUpdateImpact>();
    for (const item of out.impacts) {
      const candidateName =
        (typeof (item as any)?.characterName === 'string' ? (item as any).characterName : '') ||
        (typeof (item as any)?.character_name === 'string' ? (item as any).character_name : '') ||
        (typeof (item as any)?.name === 'string' ? (item as any).name : '') ||
        (typeof (item as any)?.character === 'string' ? (item as any).character : '') ||
        (typeof (item as any)?.characterNameZh === 'string' ? (item as any).characterNameZh : '');
      const name = typeof candidateName === 'string' ? candidateName.trim() : '';
      if (!name) continue;
      const impact = typeof item.impact === 'string' ? item.impact.trim() : undefined;
      const currentStateSummary =
        typeof (item as any).currentStateSummary === 'string'
          ? (item as any).currentStateSummary.trim()
          : typeof (item as any).current_state_summary === 'string'
            ? (item as any).current_state_summary.trim()
            : undefined;

      const existing = byName.get(name) ?? { characterName: name };
      if (impact) existing.impact = impact;
      if (currentStateSummary) existing.currentStateSummary = currentStateSummary;
      byName.set(name, existing);
    }
    out.impacts = Array.from(byName.values());
    if (out.impacts.length === 0) delete out.impacts;
  }

  return out;
};

export async function extractStreamUpdateMeta(markdown: string): Promise<ExtractedStreamMeta | null> {
  if (typeof markdown !== 'string' || !markdown.trim()) return null;

  const hit = findLastStreamMetaBlock(markdown, STREAM_UPDATE_META_MARKERS);
  const openHit = hit ? null : findLastUnclosedHtmlCommentStartWithMarker(markdown, STREAM_UPDATE_META_MARKERS);
  if (!hit && !openHit) return null;

  const rawComment = hit ? markdown.slice(hit.start, hit.end) : markdown.slice(openHit!.start);
  const candidate = extractBestJsonCandidate(hit ? hit.inner : rawComment);
  if (!candidate) return null;

  const meta = await repairNormalizeValidate({
    input: candidate,
    schema: StreamUpdateMetaSchema,
    unwrapCandidates: ['meta', 'data', 'payload', 'result', 'value'],
    textFieldCandidates: ['json', 'text', 'raw', 'content', 'body'],
    coerce: { wrapSingleToArray: true, emptyStringToUndefined: true },
    postProcess: (value) => {
      // 允许模型直接输出 impacts 数组：[{...}, {...}]
      const normalized = Array.isArray(value) ? { version: 1, impacts: value } : value;
      if (!isRecord(normalized)) return normalized;

      // 将 null / 非对象字段提前剔除：避免 schema 校验失败。
      // （例如：impacts 中夹杂了 “……/...” 被替换成 null 的占位符）
      const record = normalized as Record<string, unknown>;

      if (record.report == null || !isRecord(record.report)) {
        delete record.report;
      } else {
        const report = record.report as Record<string, unknown>;
        if (typeof report.headline !== 'string') delete report.headline;
        if (typeof report.winner !== 'string') delete report.winner;
        if (Object.keys(report).length === 0) delete record.report;
      }

      if (!Array.isArray(record.impacts)) {
        delete record.impacts;
      } else {
        const stringKeys = [
          'characterName',
          'name',
          'character',
          'character_name',
          'characterNameZh',
          'impact',
          'currentStateSummary',
          'current_state_summary',
        ] as const;
        record.impacts = record.impacts
          .filter((item) => isRecord(item))
          .map((item) => {
            const cleaned: Record<string, unknown> = { ...(item as Record<string, unknown>) };
            for (const key of stringKeys) {
              if (key in cleaned && typeof cleaned[key] !== 'string') delete cleaned[key];
            }
            return cleaned;
          });

        if ((record.impacts as unknown[]).length === 0) delete record.impacts;
      }

      return record;
    },
    as: 'object',
  });

  const sanitized = sanitizeMeta(meta as StreamUpdateMeta);
  const strippedMarkdown = hit
    ? (markdown.slice(0, hit.start) + markdown.slice(hit.end)).trimEnd()
    : markdown.slice(0, openHit!.start).trimEnd();

  return {
    meta: sanitized,
    rawComment,
    strippedMarkdown,
  };
}

const sanitizeTelemetryMeta = (meta: StreamTelemetryMeta): NormalizedStreamTelemetryMeta => {
  const out: NormalizedStreamTelemetryMeta = { ...(meta as any) };
  if (typeof (out as any).aiModel === 'string') {
    const trimmed = String((out as any).aiModel).trim();
    if (trimmed) (out as any).aiModel = trimmed;
    else delete (out as any).aiModel;
  } else if ('aiModel' in out) {
    delete (out as any).aiModel;
  }
  if (out.usage != null && !isRecord(out.usage)) {
    delete out.usage;
  }

  if (out.usage && isRecord(out.usage)) {
    const readNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null);
    const usageRecord = out.usage as Record<string, unknown>;
    const normalizedUsage = {
      ...(readNumber(usageRecord.promptTokens) !== null ? { promptTokens: readNumber(usageRecord.promptTokens) } : {}),
      ...(readNumber(usageRecord.reasoningTokens) !== null ? { reasoningTokens: readNumber(usageRecord.reasoningTokens) } : {}),
      ...(readNumber(usageRecord.completionTokens) !== null ? { completionTokens: readNumber(usageRecord.completionTokens) } : {}),
      ...(readNumber(usageRecord.totalTokens) !== null ? { totalTokens: readNumber(usageRecord.totalTokens) } : {}),
      ...(readNumber(usageRecord.cachedTokens) !== null ? { cachedTokens: readNumber(usageRecord.cachedTokens) } : {}),
    };
    out.usage = normalizedUsage;
    if (Object.keys(normalizedUsage).length === 0) delete out.usage;
  }

  if (typeof out.narrativeHistoryReadCount === 'number') {
    const fixed = Number.isFinite(out.narrativeHistoryReadCount) ? Math.max(0, Math.floor(out.narrativeHistoryReadCount)) : null;
    if (fixed === null) delete out.narrativeHistoryReadCount;
    else out.narrativeHistoryReadCount = fixed;
  }

  return out;
};

export async function extractStreamTelemetryMeta(markdown: string): Promise<ExtractedStreamTelemetryMeta | null> {
  if (typeof markdown !== 'string' || !markdown.trim()) return null;

  const hit = findLastStreamMetaBlock(markdown, ['MAHOSHOJO_TELEMETRY_META']);
  if (!hit) return null;

  const candidate = extractBestJsonCandidate(hit.inner);
  const strippedMarkdown = (markdown.slice(0, hit.start) + markdown.slice(hit.end)).trimEnd();
  const rawComment = markdown.slice(hit.start, hit.end);

  // telemetry 注释是程序自动追加的：即便 JSON 无法解析，也应优先剥离，避免“系统专用内容”漏出到 UI。
  if (!candidate) {
    return {
      meta: {},
      rawComment,
      strippedMarkdown,
    };
  }

  try {
    const meta = await repairNormalizeValidate({
      input: candidate,
      schema: StreamTelemetryMetaSchema,
      unwrapCandidates: ['meta', 'data', 'payload', 'result', 'value'],
      textFieldCandidates: ['json', 'text', 'raw', 'content', 'body'],
      coerce: { wrapSingleToArray: true, emptyStringToUndefined: true },
      as: 'object',
    });

    const sanitized = sanitizeTelemetryMeta(meta as StreamTelemetryMeta);
    return {
      meta: sanitized,
      rawComment,
      strippedMarkdown,
    };
  } catch {
    return {
      meta: {},
      rawComment,
      strippedMarkdown,
    };
  }
}
