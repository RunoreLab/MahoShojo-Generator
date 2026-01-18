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

const stripWrappingQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const parseLooseKeyValuePairs = (raw: string): Record<string, string> => {
  const pairs: Record<string, string> = {};
  const regex =
    /\b(type|level|code|message|content|text|notice|motice)\b\s*[:=]\s*("[^"]*"|'[^']*'|`[^`]*`|[^\s]+(?:\s+[^\s]+)*?)(?=\s+\b(?:type|level|code|message|content|text|notice|motice)\b\s*[:=]|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const key = match[1].toLowerCase();
    const value = stripWrappingQuotes(match[2]).replace(/[，,;；]+$/, '').trim();
    if (value) pairs[key] = value;
  }
  return pairs;
};

const stripLooseKeyValuePairs = (raw: string): string => {
  if (!raw.trim()) return '';
  const regex =
    /\b(type|level|code|message|content|text|notice|motice)\b\s*[:=]\s*("[^"]*"|'[^']*'|`[^`]*`|[^\s]+(?:\s+[^\s]+)*?)(?=\s+\b(?:type|level|code|message|content|text|notice|motice)\b\s*[:=]|$)/gi;
  const spans: Array<[number, number]> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    spans.push([match.index, regex.lastIndex]);
  }
  if (spans.length === 0) return raw;
  let remainder = raw;
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const [start, end] = spans[i];
    remainder = `${remainder.slice(0, start)}${remainder.slice(end)}`;
  }
  remainder = remainder.replace(/^[，,;；]+/, '').replace(/[，,;；]+$/, '').trim();
  return remainder;
};

const isTrivialNoticeMarker = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return ['true', 'false', 'notice', 'motice', '1', '0'].includes(normalized);
};

const hasNoticeKeywordTriplet = (pairs: Record<string, string>): boolean => {
  const hasNotice = Boolean(pairs.notice || pairs.motice);
  const hasLevel = Boolean(pairs.level);
  const hasMessage = Boolean(pairs.message || pairs.content || pairs.text);
  return hasNotice && hasLevel && hasMessage;
};

const shouldAssumeNoticeFromRecord = (record: Record<string, unknown>, raw: string): boolean => {
  const type = readString(record.type).toLowerCase();
  if (type === 'notice' || type === 'motice') return true;
  if (Object.prototype.hasOwnProperty.call(record, 'notice') || Object.prototype.hasOwnProperty.call(record, 'motice')) return true;
  const pairs = parseLooseKeyValuePairs(raw);
  return hasNoticeKeywordTriplet(pairs);
};

const parseLooseNoticeFromLine = (raw: string): MagicTeaPartyNotice | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasExplicitPrefix =
    /^notice\b/i.test(trimmed) ||
    /^motice\b/i.test(trimmed) ||
    /^mtp_notice\b/i.test(trimmed) ||
    /\btype\s*[:=]\s*(notice|motice)\b/i.test(trimmed);

  const pairs = parseLooseKeyValuePairs(trimmed);
  const hasPairs = Object.keys(pairs).length > 0;
  const isNoticeType = readString(pairs.type).toLowerCase();
  const hasKeywordTriplet = hasPairs && hasNoticeKeywordTriplet(pairs);
  if (!hasExplicitPrefix && isNoticeType !== 'notice' && isNoticeType !== 'motice' && !hasKeywordTriplet) return null;

  const tail = hasExplicitPrefix ? trimmed.replace(/^(notice|motice|mtp_notice)\b[:\s-]*/i, '').trim() : '';
  const tailPairs = tail ? parseLooseKeyValuePairs(tail) : {};
  const mergedPairs = { ...pairs, ...tailPairs };
  const messageCandidate = mergedPairs.message || mergedPairs.content || mergedPairs.text || '';
  const noticeCandidate = mergedPairs.notice || mergedPairs.motice || '';
  const level = mergedPairs.level || 'info';
  const code = mergedPairs.code || '';

  const noticePayload: Record<string, unknown> = {
    type: 'notice',
    level,
    ...(code ? { code } : {}),
    ...(messageCandidate ? { message: messageCandidate } : {}),
  };
  if (messageCandidate && noticeCandidate && !isTrivialNoticeMarker(noticeCandidate)) {
    noticePayload.notice = noticeCandidate;
  }
  const notice = parseMagicTeaPartyNoticePayload(noticePayload, { rawLine: trimmed, assumeNotice: true });
  if (notice) return notice;

  if (tail && !/\b(level|code|message|content|text|notice|motice)\b\s*[:=]/i.test(tail)) {
    return parseMagicTeaPartyNoticePayload(
      {
        type: 'notice',
        level: 'info',
        message: tail,
      },
      { rawLine: trimmed, assumeNotice: true }
    );
  }

  return null;
};

const extractLooseNoticeRemainder = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const prefixMatch = trimmed.match(/^(notice|motice|mtp_notice)\b[:\s-]*/i);
  const body = prefixMatch ? trimmed.slice(prefixMatch[0].length).trim() : trimmed;
  const remainder = stripLooseKeyValuePairs(body);
  return remainder.trim();
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

  const lines = cleanedText.split(/\r?\n/);
  const kept: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    if (isMarkdownFenceLine(raw)) {
      inFence = !inFence;
      kept.push(raw);
      continue;
    }

    if (inFence) {
      kept.push(raw);
      continue;
    }

    const parsed = tryParseJsonFromLine(raw);
    if (parsed) {
      const record = toRecord(parsed);
      const notice = parseMagicTeaPartyNoticePayload(parsed, {
        rawLine: raw,
        assumeNotice: record ? shouldAssumeNoticeFromRecord(record, raw) : false,
      });
      if (notice) {
        notices.push(notice);
        continue;
      }
    }

    const looseNotice = parseLooseNoticeFromLine(raw);
    if (looseNotice) {
      notices.push(looseNotice);
      const remainder = extractLooseNoticeRemainder(raw);
      if (remainder) {
        kept.push(remainder);
      }
      continue;
    }

    kept.push(raw);
  }

  return { cleanedText: kept.join('\n'), notices };
};
