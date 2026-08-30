import { extractHeadlineFromMarkdown, extractWinnerFromText } from '@/lib/arena/battle-report-log-utils';
import { parseBattleReportFromMarkdown } from '@/lib/arena/redo-updates';
import { extractStreamUpdateMeta, stripAllStreamMetaComments } from '@/lib/arena/stream-meta';

export type StreamBattleReportSummary = {
  headline: string | null;
  winner: string | null;
  strippedPreview: string;
  updateMetaReport: {
    headline?: string;
    winner?: string;
  } | null;
};

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export async function summarizeStreamBattleReportPreview(input: {
  preview: string | null | undefined;
  mode: string;
}): Promise<StreamBattleReportSummary> {
  const preview = typeof input.preview === 'string' ? input.preview : '';
  if (!preview.trim()) {
    return {
      headline: null,
      winner: null,
      strippedPreview: '',
      updateMetaReport: null,
    };
  }

  const extractedUpdateMeta = await extractStreamUpdateMeta(preview).catch(() => null);
  const strippedPreview = stripAllStreamMetaComments(preview);
  const rawReport = extractedUpdateMeta?.meta?.report ?? null;
  const updateMetaReport =
    rawReport && typeof rawReport === 'object'
      ? {
          ...(toTrimmedString((rawReport as { headline?: unknown }).headline)
            ? { headline: toTrimmedString((rawReport as { headline?: unknown }).headline)! }
            : {}),
          ...(toTrimmedString((rawReport as { winner?: unknown }).winner)
            ? { winner: toTrimmedString((rawReport as { winner?: unknown }).winner)! }
            : {}),
        }
      : null;

  const normalizedMetaReport =
    updateMetaReport && Object.keys(updateMetaReport).length > 0 ? updateMetaReport : null;
  const parsedFromMarkdown = strippedPreview
    ? parseBattleReportFromMarkdown(strippedPreview, typeof input.mode === 'string' ? input.mode : '')
    : null;

  return {
    headline:
      normalizedMetaReport?.headline ??
      (typeof parsedFromMarkdown?.headline === 'string' && parsedFromMarkdown.headline.trim()
        ? parsedFromMarkdown.headline.trim()
        : null) ??
      extractHeadlineFromMarkdown(strippedPreview),
    winner:
      normalizedMetaReport?.winner ??
      (typeof parsedFromMarkdown?.winner === 'string' && parsedFromMarkdown.winner.trim()
        ? parsedFromMarkdown.winner.trim()
        : null) ??
      extractWinnerFromText(strippedPreview),
    strippedPreview,
    updateMetaReport: normalizedMetaReport,
  };
}
