import { z } from 'zod/v3';

import { repairNormalizeValidate } from '@/lib/repair-pipeline';

const META_MARKERS = [
  'MAHOSHOJO_ARENA_META',
  'MAHOSHOJO_META',
  'MAHOSHOJO_STREAM_META',
] as const;

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

export interface StrippedStreamMetaComment {
  rawComment: string;
  strippedMarkdown: string;
  marker: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const normalizeJsonishText = (input: string): string => {
  return (
    input
      // 常见的“中文引号/弯引号”修复：jsonrepair 不会处理它们
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      // 统一 BOM / 零宽字符
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\u2060]/g, '')
  );
};

const findLastHtmlCommentWithMarker = (
  markdown: string
): { start: number; end: number; inner: string; marker: string } | null => {
  const MAX_TAIL_CHARS = 120_000;
  const tailStart = Math.max(0, markdown.length - MAX_TAIL_CHARS);
  const haystack = tailStart > 0 ? markdown.slice(tailStart) : markdown;

  let searchEnd = haystack.lastIndexOf('-->');
  while (searchEnd !== -1) {
    const start = haystack.lastIndexOf('<!--', searchEnd);
    if (start === -1) return null;
    const end = searchEnd + 3;
    const inner = haystack.slice(start + 4, searchEnd);
    const marker = META_MARKERS.find((m) => inner.toLowerCase().includes(m.toLowerCase()));
    if (marker) {
      return { start: start + tailStart, end: end + tailStart, inner, marker };
    }
    searchEnd = haystack.lastIndexOf('-->', start - 1);
  }
  return null;
};

export function stripStreamUpdateMetaComment(markdown: string): StrippedStreamMetaComment | null {
  if (typeof markdown !== 'string' || !markdown.trim()) return null;
  const hit = findLastHtmlCommentWithMarker(markdown);
  if (!hit) return null;
  const strippedMarkdown = (markdown.slice(0, hit.start) + markdown.slice(hit.end)).trimEnd();
  return {
    rawComment: markdown.slice(hit.start, hit.end),
    strippedMarkdown,
    marker: hit.marker,
  };
}

const extractBestJsonCandidate = (commentInner: string): string => {
  const text = normalizeJsonishText(commentInner).trim();

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
    const byName = new Map<
      string,
      StreamUpdateImpact
    >();
    for (const item of out.impacts) {
      const candidateName =
        (typeof (item as any)?.characterName === 'string' ? (item as any).characterName : '') ||
        (typeof (item as any)?.character_name === 'string' ? (item as any).character_name : '') ||
        (typeof (item as any)?.name === 'string' ? (item as any).name : '') ||
        (typeof (item as any)?.character === 'string' ? (item as any).character : '') ||
        (typeof (item as any)?.characterNameZh === 'string' ? (item as any).characterNameZh : '');
      const name = typeof candidateName === 'string' ? candidateName.trim() : '';
      if (!name || byName.has(name)) continue;
      const impact = typeof item.impact === 'string' ? item.impact.trim() : undefined;
      const currentStateSummary =
        typeof (item as any).currentStateSummary === 'string'
          ? (item as any).currentStateSummary.trim()
          : typeof (item as any).current_state_summary === 'string'
            ? (item as any).current_state_summary.trim()
            : undefined;
      byName.set(name, {
        characterName: name,
        ...(impact ? { impact } : {}),
        ...(currentStateSummary ? { currentStateSummary } : {}),
      });
    }
    out.impacts = Array.from(byName.values());
    if (out.impacts.length === 0) delete out.impacts;
  }

  return out;
};

export async function extractStreamUpdateMeta(markdown: string): Promise<ExtractedStreamMeta | null> {
  if (typeof markdown !== 'string' || !markdown.trim()) return null;

  const hit = findLastHtmlCommentWithMarker(markdown);
  if (!hit) return null;

  const candidate = extractBestJsonCandidate(hit.inner);
  if (!candidate) return null;

  const meta = await repairNormalizeValidate({
    input: candidate,
    schema: StreamUpdateMetaSchema,
    unwrapCandidates: ['meta', 'data', 'payload', 'result', 'value'],
    textFieldCandidates: ['json', 'text', 'raw', 'content', 'body'],
    coerce: { wrapSingleToArray: true, emptyStringToUndefined: true },
    postProcess: (value) => {
      // 允许模型直接输出 impacts 数组：[{...}, {...}]
      if (Array.isArray(value)) {
        return { version: 1, impacts: value };
      }
      return value;
    },
    as: 'object',
  });

  const sanitized = sanitizeMeta(meta as StreamUpdateMeta);
  const strippedMarkdown = (markdown.slice(0, hit.start) + markdown.slice(hit.end)).trimEnd();

  return {
    meta: sanitized,
    rawComment: markdown.slice(hit.start, hit.end),
    strippedMarkdown,
  };
}
