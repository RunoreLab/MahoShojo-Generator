import type { MagicTeaPartyNotice } from '@/lib/magic-tea-party/types';

type NoticeParseOptions = {
  rawLine?: string;
  assumeNotice?: boolean;
};

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeLevel = (value: unknown): MagicTeaPartyNotice['level'] => {
  const level = readString(value).toLowerCase();
  if (level === 'error' || level === 'warning' || level === 'info') return level;
  return 'info';
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export const parseMagicTeaPartyNoticePayload = (
  payload: unknown,
  options: NoticeParseOptions = {}
): MagicTeaPartyNotice | null => {
  const record = toRecord(payload);
  if (!record) return null;

  const type = readString(record.type).toLowerCase();
  const noticeText = readString(record.notice) || readString((record as Record<string, unknown>).motice);
  const noticeTextLower = noticeText.toLowerCase();
  const noticeFlag =
    (typeof record.notice === 'boolean' && record.notice) ||
    (typeof (record as Record<string, unknown>).motice === 'boolean' && (record as Record<string, unknown>).motice) ||
    noticeTextLower === 'true' ||
    noticeTextLower === 'notice' ||
    noticeTextLower === 'motice' ||
    noticeTextLower === '1';
  const noticeMessageCandidate =
    noticeText && !['true', 'false', 'notice', 'motice', '1', '0'].includes(noticeTextLower) ? noticeText : '';
  const messageCandidate = readString(record.message) || readString(record.content) || readString(record.text);
  const message = messageCandidate || noticeMessageCandidate;
  const hasNoticeShape = Boolean(message && (readString(record.level) || readString(record.code)));
  const isNoticeType = type === 'notice' || type === 'motice';
  const hasNoticeIndicator = isNoticeType || noticeFlag;
  if (type && !isNoticeType) return null;
  if (!type && !hasNoticeShape && !hasNoticeIndicator && !options.assumeNotice) return null;

  const rawFallback = readString(options.rawLine);
  const finalMessage = message || ((options.assumeNotice || hasNoticeIndicator) && rawFallback ? rawFallback : '');
  if (!finalMessage) return null;

  const code = readString(record.code);
  const meta = toRecord(record.meta) ?? undefined;

  return {
    type: 'notice',
    level: normalizeLevel(record.level),
    ...(code ? { code } : {}),
    message: finalMessage,
    ...(meta ? { meta } : {}),
  };
};

const isMarkdownFenceLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
};

const tryParseJsonFromLine = (raw: string): unknown | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isMarkdownFenceLine(trimmed)) return null;
  const normalized = trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : trimmed;
  if (!normalized) return null;
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
};

export const extractMagicTeaPartyNoticesFromJsonl = (text: string): { cleanedText: string; notices: MagicTeaPartyNotice[] } => {
  if (!text) return { cleanedText: '', notices: [] };
  const lines = text.split(/\r?\n/);
  const notices: MagicTeaPartyNotice[] = [];
  const kept: string[] = [];

  for (const raw of lines) {
    const parsed = tryParseJsonFromLine(raw);
    const notice = parsed ? parseMagicTeaPartyNoticePayload(parsed, { rawLine: raw }) : null;
    if (notice) {
      notices.push(notice);
      continue;
    }
    kept.push(raw);
  }

  return { cleanedText: kept.join('\n'), notices };
};

const NOTICE_BLOCK_REGEX = /```mtp_notice\s*([\s\S]*?)```|~~~mtp_notice\s*([\s\S]*?)~~~/gi;

export const extractMagicTeaPartyNoticesFromMarkdown = (text: string): { cleanedText: string; notices: MagicTeaPartyNotice[] } => {
  if (!text) return { cleanedText: '', notices: [] };
  const notices: MagicTeaPartyNotice[] = [];

  const cleanedText = text.replace(NOTICE_BLOCK_REGEX, (_match, blockA, blockB) => {
    const payloadRaw = typeof blockA === 'string' && blockA.trim() ? blockA : typeof blockB === 'string' ? blockB : '';
    if (!payloadRaw.trim()) return '';
    try {
      const parsed = JSON.parse(payloadRaw.trim());
      const notice = parseMagicTeaPartyNoticePayload(parsed, { rawLine: payloadRaw.trim() });
      if (notice) {
        notices.push(notice);
        return '';
      }
    } catch {
      // ignore
    }
    return _match;
  });

  return { cleanedText, notices };
};
