import type { NewsReport } from '@/components/BattleReportCard';
import { extractHeadlineFromMarkdown, extractWinnerFromText } from '@/lib/arena/battle-report-log-utils';
import { parseBattleReportFromMarkdown } from '@/lib/arena/redo-updates';
import { extractStreamTelemetryMeta } from '@/lib/arena/stream-meta';

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value : '').replace(/\r\n/g, '\n');

const looksLikeJsonText = (text: string): boolean => {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[');
};

const parseJsonSafely = (text: string): unknown | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // buildContentPreview 可能插入 “……” 破坏 JSON；看到它时直接跳过严格解析。
  if (trimmed.includes('……')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isNewsReportLike = (value: unknown): value is Partial<NewsReport> => {
  if (!isRecord(value)) return false;
  const v = value as any;
  return Boolean(
    (typeof v.headline === 'string' || v.headline == null) &&
      (isRecord(v.reporterInfo) || v.reporterInfo == null) &&
      (isRecord(v.article) || v.article == null) &&
      (isRecord(v.officialReport) || v.officialReport == null)
  );
};

const buildUsageFromRecord = (record: {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
}): NewsReport['aiUsage'] | undefined => {
  const out: Record<string, number | null> = {};
  if (typeof record.prompt_tokens === 'number') out.promptTokens = record.prompt_tokens;
  if (typeof record.reasoning_tokens === 'number') out.reasoningTokens = record.reasoning_tokens;
  if (typeof record.completion_tokens === 'number') out.completionTokens = record.completion_tokens;
  if (typeof record.total_tokens === 'number') out.totalTokens = record.total_tokens;
  if (typeof record.cached_tokens === 'number') out.cachedTokens = record.cached_tokens;
  return Object.keys(out).length > 0 ? (out as any) : undefined;
};

const mergeUsage = (
  base: NewsReport['aiUsage'] | undefined,
  patch: NewsReport['aiUsage'] | undefined
): NewsReport['aiUsage'] | undefined => {
  if (!base && !patch) return undefined;
  if (!base) return patch;
  if (!patch) return base;
  return { ...patch, ...base };
};

const stripMarkdown = (text: string): string =>
  text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/, '')
    .trim();

const extractSectionContent = (markdown: string, headingRegex: RegExp): string | null => {
  const lines = normalizeText(markdown).split('\n');
  const startIndex = lines.findIndex((line) => headingRegex.test(line.trim()));
  if (startIndex === -1) return null;

  const out: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s+/.test(line.trim())) break;
    out.push(line);
  }

  const joined = out.join('\n').trim();
  return joined ? joined : null;
};

const extractBodyFromMarkdown = (markdown: string): { body: string; analysis: string } => {
  const normalized = normalizeText(markdown).trim();
  if (!normalized) return { body: '', analysis: '' };

  const newsBody = extractSectionContent(normalized, /^##\s*(?:新闻正文|正文)\s*$/);
  const reporterAnalysis = extractSectionContent(normalized, /^##\s*(?:记者点评|点评|记者评论)\s*$/) ?? '';
  if (newsBody) return { body: newsBody, analysis: reporterAnalysis };

  const lines = normalized.split('\n');
  const firstNonEmpty = lines.findIndex((l) => l.trim());
  const start = firstNonEmpty >= 0 ? firstNonEmpty : 0;

  let cursor = start;
  if (/^#{1,3}\s+/.test(lines[cursor]?.trim() || '')) cursor += 1;
  while (cursor < lines.length && !lines[cursor]?.trim()) cursor += 1;

  const stopHeadings = [
    /^##\s*(?:胜利者|获胜者|优胜者)\s*$/,
    /^##\s*(?:最终结果|结论|结果)\s*$/,
    /^##\s*(?:官方通报)\s*$/,
    /^##\s*(?:记者点评|点评|记者评论)\s*$/,
    /^##\s*(?:故事引导)\s*$/,
    /^##\s*(?:随机判定记录)\s*$/,
  ];

  let stop = lines.length;
  for (let i = cursor; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t) continue;
    if (stopHeadings.some((re) => re.test(t))) {
      stop = i;
      break;
    }
  }

  const body = lines.slice(cursor, stop).join('\n').trim();
  return { body, analysis: reporterAnalysis };
};

const safeMode = (mode: unknown): NewsReport['mode'] | undefined => {
  if (mode === 'classic' || mode === 'kizuna' || mode === 'daily' || mode === 'scenario') return mode;
  return undefined;
};

export type BattleReportCardHydrateResult = {
  report: NewsReport;
  liveBody?: string;
};

export async function hydrateBattleReportCardFromGenerationRecord(input: {
  generationMode: string | null | undefined;
  endpoint: string | null | undefined;
  mode: unknown;
  scenarioTitle: unknown;
  headline: unknown;
  winner: unknown;
  outputPreview: unknown;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  userGuidance?: string;
}): Promise<BattleReportCardHydrateResult> {
  const generationMode = typeof input.generationMode === 'string' ? input.generationMode : '';
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint : '';
  const rawPreview = normalizeText(input.outputPreview);
  const scenario = typeof input.scenarioTitle === 'string' && input.scenarioTitle.trim() ? input.scenarioTitle.trim() : undefined;
  const userGuidance = typeof input.userGuidance === 'string' && input.userGuidance.trim() ? input.userGuidance.trim() : undefined;

  const usageFromRecord = buildUsageFromRecord({
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
    total_tokens: input.totalTokens,
    cached_tokens: input.cachedTokens,
    reasoning_tokens: input.reasoningTokens,
  });

  // 1) 非流式：优先复用 JSON（若未被截断）；否则至少不要把 JSON 当作正文。
  if (generationMode === 'non-stream' || (looksLikeJsonText(rawPreview) && generationMode !== 'stream')) {
    const parsed = parseJsonSafely(rawPreview);
    const reportCandidate = (() => {
      if (isNewsReportLike(parsed)) return parsed;
      if (isRecord(parsed) && isNewsReportLike((parsed as any).report)) return (parsed as any).report as any;
      return null;
    })();

    const headline =
      (typeof input.headline === 'string' && input.headline.trim()) ||
      (reportCandidate && typeof reportCandidate.headline === 'string' ? reportCandidate.headline.trim() : '') ||
      '战报';

    const winner =
      (typeof input.winner === 'string' && input.winner.trim()) ||
      (reportCandidate && typeof (reportCandidate as any)?.officialReport?.winner === 'string'
        ? String((reportCandidate as any).officialReport.winner).trim()
        : '') ||
      '未知';

    const narrativeHistoryReadCount =
      (reportCandidate && typeof (reportCandidate as any)?.narrativeHistoryReadCount === 'number'
        ? Math.max(0, Math.floor((reportCandidate as any).narrativeHistoryReadCount))
        : null) ??
      (() => {
        const m = rawPreview.match(/"narrativeHistoryReadCount"\s*:\s*(\d+)/);
        return m?.[1] ? Math.max(0, Math.floor(Number(m[1]))) : null;
      })();

    const base: NewsReport = {
      headline,
      ...(scenario ? { scenario } : {}),
      reporterInfo: {
        name: '系统',
        publication: endpoint || 'A.R.E.N.A.',
      },
      article: { body: '', analysis: '' },
      officialReport: { winner, conclusion: '' },
      ...(safeMode(input.mode) ? { mode: safeMode(input.mode) } : {}),
      ...(userGuidance ? { userGuidance } : {}),
    };

    const merged: NewsReport = reportCandidate ? ({ ...base, ...(reportCandidate as any) } as NewsReport) : base;
    merged.aiUsage = mergeUsage(merged.aiUsage, usageFromRecord);
    if (typeof merged.narrativeHistoryReadCount !== 'number' && typeof narrativeHistoryReadCount === 'number') {
      merged.narrativeHistoryReadCount = narrativeHistoryReadCount;
    }

    // 非流式：优先用结构化 report.article.body；若 preview 为截断 JSON，则 body 可能缺失，不强行塞 JSON。
    return { report: merged };
  }

  // 2) 流式：复用原始 Markdown（liveBody），并从 telemetry 注释中提取 usage / narrativeHistoryReadCount。
  const telemetryExtracted = rawPreview ? await extractStreamTelemetryMeta(rawPreview) : null;
  const stripped = telemetryExtracted?.strippedMarkdown ?? rawPreview;

  const parsedFromMarkdown = stripped ? parseBattleReportFromMarkdown(stripped, typeof input.mode === 'string' ? input.mode : '') : null;

  const headline =
    (typeof input.headline === 'string' && input.headline.trim()) ||
    parsedFromMarkdown?.headline ||
    extractHeadlineFromMarkdown(stripped) ||
    '战报';

  const winner =
    (typeof input.winner === 'string' && input.winner.trim()) ||
    parsedFromMarkdown?.winner ||
    extractWinnerFromText(stripped) ||
    '未知';

  const { body, analysis } = extractBodyFromMarkdown(stripped);

  const report: NewsReport = {
    headline,
    ...(scenario ? { scenario } : {}),
    reporterInfo: {
      name: '系统',
      publication: endpoint || 'A.R.E.N.A.',
    },
    article: { body, analysis },
    officialReport: { winner: stripMarkdown(winner), conclusion: '' },
    ...(safeMode(input.mode) ? { mode: safeMode(input.mode) } : {}),
    ...(userGuidance ? { userGuidance } : {}),
  };

  const usageFromTelemetry = telemetryExtracted?.meta?.usage as NewsReport['aiUsage'] | undefined;
  report.aiUsage = mergeUsage(usageFromTelemetry, usageFromRecord);

  if (typeof telemetryExtracted?.meta?.narrativeHistoryReadCount === 'number') {
    report.narrativeHistoryReadCount = telemetryExtracted.meta.narrativeHistoryReadCount;
  }

  return { report, liveBody: stripped };
}
