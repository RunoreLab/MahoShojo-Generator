import { quickCheck } from '@/lib/sensitive-word-filter';
import { applyShieldWords } from '@/lib/shield-word-filter';

import { buildStreamSensitiveArrestWarrantMarkdown } from '@/lib/stream/arrest-warrant';
import { STREAM_ABORT_REASON_OUTPUT_SAFETY } from '@/lib/stream/abort';

type StreamSensitiveMatchDetail = {
  startIndex?: number;
};

type StreamSensitiveCheckResult = {
  hasSensitiveWords: boolean;
  filteredText: string;
  detectedWords?: string[];
  matchDetails?: StreamSensitiveMatchDetail[];
};

export type StreamOutputSafetyResult = {
  status: 'blocked' | 'done';
  safeText: string;
  blockedAt: number | null;
  truncatedAt: number | null;
};

export type StreamOutputSafetyController = {
  ingest: (raw: string) => void;
  finalize: (rawFinal: string) => Promise<StreamOutputSafetyResult>;
  finalizeAfterAbort: (reason: unknown) => Promise<StreamOutputSafetyResult>;
  clearTimer: () => void;
  getRawSnapshot: () => string;
  getSafeSnapshot: () => string;
  getBlockedAt: () => number | null;
  getTruncatedAt: () => number | null;
};

type StreamOutputSafetyOptions = {
  onSafePreview?: (safeText: string) => void;
  onBlocked?: (safeText: string, truncatedAt: number | null) => void;
  delayMs?: number;
  reason?: string;
  checkText?: (text: string) => Promise<StreamSensitiveCheckResult>;
};

const getEarliestSensitiveStartIndex = (result: StreamSensitiveCheckResult): number | null => {
  if (!Array.isArray(result.matchDetails) || result.matchDetails.length === 0) return null;

  let earliest = Number.POSITIVE_INFINITY;
  for (const detail of result.matchDetails) {
    if (!detail || typeof detail.startIndex !== 'number') continue;
    if (detail.startIndex >= 0) earliest = Math.min(earliest, detail.startIndex);
  }

  return Number.isFinite(earliest) ? earliest : null;
};

const findOutputSafetyBoundaryIndex = (text: string, matchStartIndex: number): number => {
  if (!text) return 0;
  const searchFrom = Math.min(text.length - 1, Math.max(0, matchStartIndex - 1));
  let boundary = -1;
  for (const ch of ['\n', '。', '！', '？', '.', '!', '?']) {
    boundary = Math.max(boundary, text.lastIndexOf(ch, searchFrom));
  }
  return boundary >= 0 ? boundary + 1 : 0;
};

const truncateUnsafeOutputText = (
  text: string,
  result: StreamSensitiveCheckResult
): { safeRaw: string; truncatedAt: number | null } => {
  const matchStart = getEarliestSensitiveStartIndex(result);
  if (matchStart === null) {
    return { safeRaw: text, truncatedAt: null };
  }

  const boundary = findOutputSafetyBoundaryIndex(text, matchStart);
  return { safeRaw: text.slice(0, boundary), truncatedAt: boundary };
};

const buildBlockedSafeText = (safeRaw: string, reason?: string): string => {
  const safePrefix = applyShieldWords(safeRaw).filteredText.trimEnd();
  const warrant = buildStreamSensitiveArrestWarrantMarkdown(reason);
  return safePrefix ? `${safePrefix}${warrant}` : warrant.trimStart();
};

export function createStreamOutputSafetyController(
  options: StreamOutputSafetyOptions = {}
): StreamOutputSafetyController {
  const {
    onSafePreview,
    onBlocked,
    delayMs = 120,
    reason = '使用危险符文',
    checkText = quickCheck,
  } = options;

  let streamedRawSoFar = '';
  let streamedSafeSoFar = '';
  let blockedSafeText = '';
  let outputBlockedAt: number | null = null;
  let outputSafetyTruncatedAt: number | null = null;
  let safetyCheckTimer: ReturnType<typeof setTimeout> | null = null;
  let safetyCheckInFlight = false;

  const scheduleSafetyCheck = () => {
    if (outputBlockedAt || safetyCheckTimer) return;
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
      const result = await checkText(snapshot);
      if (outputBlockedAt) return;

      if (result.hasSensitiveWords) {
        const { safeRaw, truncatedAt } = truncateUnsafeOutputText(snapshot, result);
        blockedSafeText = buildBlockedSafeText(safeRaw, reason);
        streamedSafeSoFar = blockedSafeText;
        outputBlockedAt = Date.now();
        outputSafetyTruncatedAt = truncatedAt;
        onBlocked?.(blockedSafeText, truncatedAt);
        return;
      }

      streamedSafeSoFar = applyShieldWords(snapshot).filteredText;
      onSafePreview?.(streamedSafeSoFar);
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

  const finalizeBlocked = (safeText: string): StreamOutputSafetyResult => ({
    status: 'blocked',
    safeText,
    blockedAt: outputBlockedAt ?? Date.now(),
    truncatedAt: outputSafetyTruncatedAt,
  });

  return {
    ingest(raw: string) {
      streamedRawSoFar = raw;
      scheduleSafetyCheck();
    },

    async finalize(rawFinal: string): Promise<StreamOutputSafetyResult> {
      clearTimer();
      if (outputBlockedAt) {
        return finalizeBlocked(blockedSafeText || streamedSafeSoFar);
      }

      const result = await checkText(rawFinal);
      if (result.hasSensitiveWords) {
        const { safeRaw, truncatedAt } = truncateUnsafeOutputText(rawFinal, result);
        outputSafetyTruncatedAt = truncatedAt;
        outputBlockedAt = Date.now();
        blockedSafeText = buildBlockedSafeText(safeRaw, reason);
        return finalizeBlocked(blockedSafeText);
      }

      const safeText = applyShieldWords(rawFinal).filteredText;
      streamedSafeSoFar = safeText;
      return {
        status: 'done',
        safeText,
        blockedAt: null,
        truncatedAt: null,
      };
    },

    async finalizeAfterAbort(reasonValue: unknown): Promise<StreamOutputSafetyResult> {
      clearTimer();
      if (outputBlockedAt || reasonValue === STREAM_ABORT_REASON_OUTPUT_SAFETY) {
        return finalizeBlocked(blockedSafeText || streamedSafeSoFar);
      }

      const result = await checkText(streamedRawSoFar);
      if (result.hasSensitiveWords) {
        const { safeRaw, truncatedAt } = truncateUnsafeOutputText(streamedRawSoFar, result);
        outputSafetyTruncatedAt = truncatedAt;
        outputBlockedAt = Date.now();
        blockedSafeText = buildBlockedSafeText(safeRaw, reason);
        return finalizeBlocked(blockedSafeText);
      }

      const safeText = applyShieldWords(streamedRawSoFar).filteredText;
      streamedSafeSoFar = safeText;
      return {
        status: 'done',
        safeText,
        blockedAt: null,
        truncatedAt: null,
      };
    },

    clearTimer,
    getRawSnapshot: () => streamedRawSoFar,
    getSafeSnapshot: () => streamedSafeSoFar,
    getBlockedAt: () => outputBlockedAt,
    getTruncatedAt: () => outputSafetyTruncatedAt,
  };
}

export { STREAM_ABORT_REASON_OUTPUT_SAFETY };
