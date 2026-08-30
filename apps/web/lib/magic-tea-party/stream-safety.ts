import type { MagicTeaPartySession } from '@/lib/magic-tea-party/types';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { quickCheck } from '@/lib/sensitive-word-filter';

type MagicTeaPartyOutputFormat = NonNullable<MagicTeaPartySession['settings']['outputFormat']>;
type QuickCheckResult = Awaited<ReturnType<typeof quickCheck>>;

export type MagicTeaPartyStreamSafetyResult = {
  status: 'blocked' | 'done';
  safeText: string;
  blockedAt: number | null;
  truncatedAt: number | null;
};

export type MagicTeaPartyStreamSafetyController = {
  ingest: (raw: string) => void;
  finalize: (rawFinal: string) => Promise<MagicTeaPartyStreamSafetyResult>;
  finalizeAfterAbort: (reason: unknown) => Promise<MagicTeaPartyStreamSafetyResult>;
  clearTimer: () => void;
  getRawSnapshot: () => string;
  getSafeSnapshot: () => string;
  getBlockedAt: () => number | null;
  getTruncatedAt: () => number | null;
};

type StreamSafetyOptions = {
  outputFormat: MagicTeaPartyOutputFormat;
  onSafePreview: (safeText: string) => void;
  onBlocked: (safeText: string, truncatedAt: number | null) => void;
  delayMs?: number;
};

const getEarliestSensitiveStartIndex = (result: QuickCheckResult): number | null => {
  const details = result.matchDetails;
  if (!Array.isArray(details) || details.length === 0) return null;

  let earliest = Number.POSITIVE_INFINITY;
  for (const detail of details) {
    if (!detail || typeof detail.startIndex !== 'number') continue;
    if (detail.startIndex >= 0) earliest = Math.min(earliest, detail.startIndex);
  }

  return Number.isFinite(earliest) ? earliest : null;
};

const findOutputSafetyBoundaryIndex = (text: string, matchStartIndex: number, outputFormat: MagicTeaPartyOutputFormat): number => {
  if (!text) return 0;
  const searchFrom = Math.min(text.length - 1, Math.max(0, matchStartIndex - 1));

  if (outputFormat === 'jsonl') {
    const newline = text.lastIndexOf('\n', searchFrom);
    return newline >= 0 ? newline + 1 : 0;
  }

  let boundary = -1;
  for (const ch of ['\n', '。', '！', '？', '.', '!', '?']) {
    boundary = Math.max(boundary, text.lastIndexOf(ch, searchFrom));
  }
  return boundary >= 0 ? boundary + 1 : 0;
};

const truncateUnsafeOutputText = (
  text: string,
  result: QuickCheckResult,
  outputFormat: MagicTeaPartyOutputFormat
): { safeRaw: string; truncatedAt: number | null } => {
  const matchStart = getEarliestSensitiveStartIndex(result);
  if (matchStart === null) return { safeRaw: text, truncatedAt: null };

  const boundary = findOutputSafetyBoundaryIndex(text, matchStart, outputFormat);
  return { safeRaw: text.slice(0, boundary), truncatedAt: boundary };
};

export function createMagicTeaPartyStreamSafety(options: StreamSafetyOptions): MagicTeaPartyStreamSafetyController {
  const { outputFormat, onSafePreview, onBlocked, delayMs = 120 } = options;

  let streamedRawSoFar = '';
  let streamedSafeSoFar = '';
  let outputBlockedAt: number | null = null;
  let outputSafetyTruncatedAt: number | null = null;
  let safetyCheckTimer: ReturnType<typeof setTimeout> | null = null;
  let safetyCheckInFlight = false;

  const buildBlockedSafeText = () => {
    if (streamedSafeSoFar) return streamedSafeSoFar;
    if (typeof outputSafetyTruncatedAt === 'number') {
      return applyShieldWords(streamedRawSoFar.slice(0, outputSafetyTruncatedAt)).filteredText;
    }
    return applyShieldWords(streamedRawSoFar).filteredText;
  };

  const scheduleSafetyCheck = () => {
    if (outputBlockedAt) return;
    if (safetyCheckTimer) return;
    safetyCheckTimer = setTimeout(() => {
      safetyCheckTimer = null;
      void runSafetyCheck();
    }, delayMs);
  };

  const runSafetyCheck = async () => {
    if (outputBlockedAt) return;
    if (safetyCheckInFlight) {
      scheduleSafetyCheck();
      return;
    }

    safetyCheckInFlight = true;
    const snapshot = streamedRawSoFar;
    try {
      const result = await quickCheck(snapshot);
      if (outputBlockedAt) return;

      if (result.hasSensitiveWords) {
        const { safeRaw, truncatedAt } = truncateUnsafeOutputText(snapshot, result, outputFormat);
        const safeText = applyShieldWords(safeRaw).filteredText;
        streamedSafeSoFar = safeText;
        outputBlockedAt = Date.now();
        outputSafetyTruncatedAt = truncatedAt;
        onBlocked(safeText, truncatedAt);
        return;
      }

      const safePreview = applyShieldWords(snapshot).filteredText;
      streamedSafeSoFar = safePreview;
      onSafePreview(safePreview);
    } finally {
      safetyCheckInFlight = false;
      if (!outputBlockedAt && streamedRawSoFar !== snapshot) scheduleSafetyCheck();
    }
  };

  const clearTimer = () => {
    if (!safetyCheckTimer) return;
    clearTimeout(safetyCheckTimer);
    safetyCheckTimer = null;
  };

  const ingest = (raw: string) => {
    streamedRawSoFar = raw;
    scheduleSafetyCheck();
  };

  const finalize = async (rawFinal: string): Promise<MagicTeaPartyStreamSafetyResult> => {
    clearTimer();
    let status: MagicTeaPartyStreamSafetyResult['status'] = outputBlockedAt ? 'blocked' : 'done';
    let safeText = outputBlockedAt ? buildBlockedSafeText() : streamedSafeSoFar;
    let blockedAt = outputBlockedAt;
    let truncatedAt = outputSafetyTruncatedAt;

    if (!outputBlockedAt) {
      const sensitive = await quickCheck(rawFinal);
      if (sensitive.hasSensitiveWords) {
        const truncated = truncateUnsafeOutputText(rawFinal, sensitive, outputFormat);
        safeText = applyShieldWords(truncated.safeRaw).filteredText;
        status = 'blocked';
        blockedAt = Date.now();
        truncatedAt = truncated.truncatedAt;
      } else {
        safeText = applyShieldWords(rawFinal).filteredText;
        status = 'done';
      }
    }

    return {
      status,
      safeText,
      blockedAt,
      truncatedAt,
    };
  };

  const finalizeAfterAbort = async (reason: unknown): Promise<MagicTeaPartyStreamSafetyResult> => {
    clearTimer();
    if (outputBlockedAt || reason === 'output-safety') {
      return {
        status: 'blocked',
        safeText: buildBlockedSafeText(),
        blockedAt: outputBlockedAt ?? Date.now(),
        truncatedAt: outputSafetyTruncatedAt,
      };
    }

    const sensitive = await quickCheck(streamedRawSoFar);
    if (sensitive.hasSensitiveWords) {
      const truncated = truncateUnsafeOutputText(streamedRawSoFar, sensitive, outputFormat);
      return {
        status: 'blocked',
        safeText: applyShieldWords(truncated.safeRaw).filteredText,
        blockedAt: Date.now(),
        truncatedAt: null,
      };
    }

    return {
      status: 'done',
      safeText: applyShieldWords(streamedRawSoFar).filteredText,
      blockedAt: null,
      truncatedAt: null,
    };
  };

  return {
    ingest,
    finalize,
    finalizeAfterAbort,
    clearTimer,
    getRawSnapshot: () => streamedRawSoFar,
    getSafeSnapshot: () => streamedSafeSoFar,
    getBlockedAt: () => outputBlockedAt,
    getTruncatedAt: () => outputSafetyTruncatedAt,
  };
}
