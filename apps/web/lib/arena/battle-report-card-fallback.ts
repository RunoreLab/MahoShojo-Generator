import type { NewsReport } from '@/components/BattleReportCard';
import type { BattleReportRenderSnapshotV1 } from '@mahoshojo/contracts';
import { normalizeUsage } from '@/lib/arena/battle-report-log-utils';
import { summarizeStreamBattleReportPreview } from '@/lib/arena/stream-report-summary';
import {
  extractStreamTelemetryMeta,
  stripAllStreamMetaComments,
} from '@/lib/arena/stream-meta';

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

const stripBlockquoteMarkers = (text: string): string => (
  text.replace(/^[\t ]*>[\t ]?/gm, '').trim()
);

const extractBodyFromMarkdown = (markdown: string): { body: string; analysis: string } => {
  const normalized = normalizeText(markdown).trim();
  if (!normalized) return { body: '', analysis: '' };

  const newsBody = extractSectionContent(normalized, /^##\s*(?:新闻正文|正文|News Body|Body)\s*$/iu);
  const reporterAnalysis = stripBlockquoteMarkers(
    extractSectionContent(
      normalized,
      /^##\s*(?:记者点评|点评|记者评论|Reporter Analysis|Commentary)\s*$/iu,
    ) ?? ''
  );
  if (newsBody) return { body: newsBody, analysis: reporterAnalysis };

  const lines = normalized.split('\n');
  const firstNonEmpty = lines.findIndex((l) => l.trim());
  const start = firstNonEmpty >= 0 ? firstNonEmpty : 0;

  let cursor = start;
  if (/^#{1,3}\s+/.test(lines[cursor]?.trim() || '')) cursor += 1;
  while (cursor < lines.length && !lines[cursor]?.trim()) cursor += 1;

  const stopHeadings = [
    /^##\s*(?:胜利者|获胜者|优胜者|Winner)\s*$/iu,
    /^##\s*(?:最终结果|结论|结果|Final Result|Conclusion|Result)\s*$/iu,
    /^##\s*(?:官方通报|Official Report)\s*$/iu,
    /^##\s*(?:记者点评|点评|记者评论|Reporter Analysis|Commentary)\s*$/iu,
    /^##\s*(?:故事引导|Story Guidance)\s*$/iu,
    /^##\s*(?:随机判定记录|Adjudication Record)\s*$/iu,
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

const extractConclusionFromMarkdown = (markdown: string): string => (
  extractSectionContent(
    markdown,
    /^##\s*(?:最终结果|结论|结果|Final Result|Conclusion|Result)\s*$/iu,
  ) ?? ''
);

const extractWinnerFromMarkdown = (markdown: string): string => (
  extractSectionContent(markdown, /^##\s*(?:胜利者|获胜者|优胜者|Winner)\s*$/iu) ?? ''
);

const safeMode = (mode: unknown): NewsReport['mode'] | undefined => {
  if (mode === 'classic' || mode === 'kizuna' || mode === 'daily' || mode === 'scenario') return mode;
  return undefined;
};

export type BattleReportCardHydrateResult = {
  report: NewsReport;
  liveBody?: string;
};

const applyRenderSnapshot = (
  report: NewsReport,
  snapshot: BattleReportRenderSnapshotV1 | null | undefined,
  explicitUserGuidance: string | undefined,
): NewsReport => {
  if (!snapshot) return report;

  const merged: NewsReport = {
    ...report,
    ...(snapshot.reporterInfo ? { reporterInfo: snapshot.reporterInfo } : {}),
    ...(snapshot.userGuidance ? { userGuidance: snapshot.userGuidance } : {}),
    ...(snapshot.characterGuidances ? { characterGuidances: snapshot.characterGuidances } : {}),
    ...(snapshot.adjudicationResults ? { adjudicationResults: snapshot.adjudicationResults } : {}),
    ...(typeof snapshot.narrativeHistoryReadCount === 'number'
      ? { narrativeHistoryReadCount: snapshot.narrativeHistoryReadCount }
      : {}),
  };
  if (explicitUserGuidance) merged.userGuidance = explicitUserGuidance;
  return merged;
};

export async function hydrateBattleReportCardFromGenerationRecord(input: {
  generationMode: string | null | undefined;
  endpoint: string | null | undefined;
  mode: unknown;
  scenarioTitle: unknown;
  headline: unknown;
  winner: unknown;
  outputPreview: unknown;
  aiModel?: unknown;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  userGuidance?: string;
  renderSnapshot?: BattleReportRenderSnapshotV1 | null;
}): Promise<BattleReportCardHydrateResult> {
  const generationMode = typeof input.generationMode === 'string' ? input.generationMode : '';
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint : '';
  const rawPreview = normalizeText(input.outputPreview);
  const scenario = typeof input.scenarioTitle === 'string' && input.scenarioTitle.trim() ? input.scenarioTitle.trim() : undefined;
  const userGuidance = typeof input.userGuidance === 'string' && input.userGuidance.trim() ? input.userGuidance.trim() : undefined;
  const aiModelFromRecord = typeof input.aiModel === 'string' && input.aiModel.trim() ? input.aiModel.trim() : undefined;

  const usageFromRecord = buildUsageFromRecord({
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
    total_tokens: input.totalTokens,
    cached_tokens: input.cachedTokens,
    reasoning_tokens: input.reasoningTokens,
  });

  const parsedPreview = parseJsonSafely(rawPreview);
  const parsedReportCandidate = (() => {
    if (isNewsReportLike(parsedPreview)) return parsedPreview;
    if (isRecord(parsedPreview) && isNewsReportLike(parsedPreview.report)) {
      return parsedPreview.report;
    }
    return null;
  })();
  const trimmedPreview = rawPreview.trim();
  const isTruncatedLegacyJson = looksLikeJsonText(rawPreview)
    && (trimmedPreview === '{' || trimmedPreview === '[' || trimmedPreview.includes('……'));
  const shouldUseLegacyJsonFallback = generationMode !== 'stream'
    && (!trimmedPreview || parsedReportCandidate !== null || isTruncatedLegacyJson);

  // 1) 非流式旧记录按实际内容识别 JSON（包括只剩起始括号的截断 preview）。
  if (shouldUseLegacyJsonFallback) {
    const reportCandidate = parsedReportCandidate;

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
    if (aiModelFromRecord && !(typeof merged.aiModel === 'string' && merged.aiModel.trim())) {
      merged.aiModel = aiModelFromRecord;
    }
    if (typeof merged.narrativeHistoryReadCount !== 'number' && typeof narrativeHistoryReadCount === 'number') {
      merged.narrativeHistoryReadCount = narrativeHistoryReadCount;
    }

    // 非流式：优先用结构化 report.article.body；若 preview 为截断 JSON，则 body 可能缺失，不强行塞 JSON。
    return { report: applyRenderSnapshot(merged, input.renderSnapshot, userGuidance) };
  }

  // 2) 其余非空内容按 Markdown 解析；只有 stream consumer 需要保留 liveBody。
  const telemetryExtracted = rawPreview ? await extractStreamTelemetryMeta(rawPreview) : null;
  const streamSummary = await summarizeStreamBattleReportPreview({
    preview: rawPreview,
    mode: typeof input.mode === 'string' ? input.mode : '',
  });
  const stripped = streamSummary.strippedPreview || stripAllStreamMetaComments(rawPreview);

  const headline =
    streamSummary.headline ||
    (typeof input.headline === 'string' && input.headline.trim()) ||
    '战报';

  const winner =
    streamSummary.winner ||
    (typeof input.winner === 'string' && input.winner.trim()) ||
    extractWinnerFromMarkdown(stripped) ||
    '未知';

  const { body, analysis } = extractBodyFromMarkdown(stripped);
  const conclusion = extractConclusionFromMarkdown(stripped);

  const report: NewsReport = {
    headline,
    ...(scenario ? { scenario } : {}),
    reporterInfo: {
      name: '系统',
      publication: endpoint || 'A.R.E.N.A.',
    },
    article: { body, analysis },
    officialReport: { winner: stripMarkdown(winner), conclusion },
    ...(safeMode(input.mode) ? { mode: safeMode(input.mode) } : {}),
    ...(userGuidance ? { userGuidance } : {}),
  };

  const usageFromTelemetry = normalizeUsage(telemetryExtracted?.meta?.usage ?? null) ?? undefined;
  report.aiUsage = mergeUsage(usageFromTelemetry, usageFromRecord);

  const aiModelFromTelemetry = typeof telemetryExtracted?.meta?.aiModel === 'string' && telemetryExtracted.meta.aiModel.trim()
    ? telemetryExtracted.meta.aiModel.trim()
    : undefined;
  const aiModel = aiModelFromTelemetry || aiModelFromRecord;
  if (aiModel) {
    report.aiModel = aiModel;
  }

  if (typeof telemetryExtracted?.meta?.narrativeHistoryReadCount === 'number') {
    report.narrativeHistoryReadCount = telemetryExtracted.meta.narrativeHistoryReadCount;
  }

  const renderedReport = applyRenderSnapshot(report, input.renderSnapshot, userGuidance);
  return generationMode === 'stream'
    ? { report: renderedReport, liveBody: stripped }
    : { report: renderedReport };
}
