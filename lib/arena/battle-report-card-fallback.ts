import type { NewsReport } from '@/components/BattleReportCard';
import { extractHeadlineFromMarkdown, extractWinnerFromText } from '@/lib/arena/battle-report-log-utils';

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value : '').replace(/\r\n/g, '\n');

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

const extractWinnerFromMarkdown = (markdown: string): string | null => {
  const winnerSection = extractSectionContent(markdown, /^##\s*(?:胜利者|获胜者|优胜者)\s*$/);
  if (!winnerSection) return null;

  const meaningful = winnerSection.split('\n').map((l) => l.trim()).filter(Boolean);
  const bulletItems = meaningful
    .map((line) => {
      const m = line.match(/^\s*[-*]\s+(.+)$/);
      return m?.[1]?.trim() ?? null;
    })
    .filter((item): item is string => Boolean(item));

  if (bulletItems.length > 0) return bulletItems.map(stripMarkdown).join('、').slice(0, 80);
  return stripMarkdown(meaningful[0] ?? '').slice(0, 80) || null;
};

const extractConclusionFromMarkdown = (markdown: string): string | null => {
  const conclusionSection = extractSectionContent(markdown, /^##\s*(?:最终结果|结论|结果)\s*$/);
  if (conclusionSection) {
    const lines = conclusionSection.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) return stripMarkdown(lines[0]).slice(0, 300) || null;
  }

  const officialSection = extractSectionContent(markdown, /^##\s*(?:官方通报)\s*$/);
  if (officialSection) {
    const m = officialSection.match(/最终结果\s*[:：]\s*([^\n\r]+)/);
    if (m?.[1]) return stripMarkdown(m[1]).slice(0, 300) || null;
  }

  return null;
};

const extractReporterInfoFromMarkdown = (markdown: string): { publication: string; name: string } | null => {
  const m = normalizeText(markdown).match(/来源\s*[:：]\s*([^|\n\r]+)\s*\|\s*记者\s*[:：]\s*([^\n\r]+)/);
  if (!m) return null;
  const publication = (m[1] ?? '').trim();
  const name = (m[2] ?? '').trim();
  if (!publication && !name) return null;
  return { publication, name };
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

export function buildBattleReportCardFromStoredData(input: {
  mode?: unknown;
  scenarioTitle?: unknown;
  headline?: unknown;
  winner?: unknown;
  outputMarkdownPreview?: unknown;
  endpoint?: unknown;
  userGuidance?: unknown;
}): NewsReport {
  const markdown = normalizeText(input.outputMarkdownPreview).trim();
  const headline =
    (typeof input.headline === 'string' && input.headline.trim()) ||
    extractHeadlineFromMarkdown(markdown) ||
    '战报';

  const parsedReporter = markdown ? extractReporterInfoFromMarkdown(markdown) : null;
  const publication =
    parsedReporter?.publication?.trim() ||
    (typeof input.endpoint === 'string' && input.endpoint ? input.endpoint : '') ||
    'A.R.E.N.A.';
  const reporterName = parsedReporter?.name?.trim() || '系统';

  const { body, analysis } = markdown ? extractBodyFromMarkdown(markdown) : { body: '', analysis: '' };

  const winner =
    (typeof input.winner === 'string' && input.winner.trim()) ||
    (markdown ? extractWinnerFromMarkdown(markdown) : null) ||
    extractWinnerFromText(markdown || body) ||
    '未知';

  const conclusion = markdown ? extractConclusionFromMarkdown(markdown) : null;

  const userGuidance =
    typeof input.userGuidance === 'string' && input.userGuidance.trim() ? input.userGuidance.trim() : undefined;

  return {
    headline,
    ...(typeof input.scenarioTitle === 'string' && input.scenarioTitle.trim()
      ? { scenario: input.scenarioTitle.trim() }
      : {}),
    reporterInfo: { name: reporterName, publication },
    article: { body, analysis },
    officialReport: { winner, conclusion: conclusion ?? '' },
    ...(safeMode(input.mode) ? { mode: safeMode(input.mode) } : {}),
    ...(userGuidance ? { userGuidance } : {}),
  };
}

