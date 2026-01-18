import type {
  MagicTeaPartyNotice,
  MagicTeaPartyOutputSegment,
  MagicTeaPartyOutputSummary,
  MagicTeaPartyUpdateDraft,
} from '@/lib/magic-tea-party/types';
import { parseMagicTeaPartyNoticePayload } from '@/lib/magic-tea-party/notice';
import { jsonrepair } from 'jsonrepair';

type ParseResult = {
  segments: MagicTeaPartyOutputSegment[];
  choices: { id: string; text: string }[] | null;
  notices: MagicTeaPartyNotice[];
  summary: MagicTeaPartyOutputSummary | null;
  updates: MagicTeaPartyUpdateDraft[] | null;
  updatesMeta: Record<string, unknown> | null;
};

export type MagicTeaPartyJsonlStreamState = {
  buffer: string;
  segments: MagicTeaPartyOutputSegment[];
  choices: { id: string; text: string }[] | null;
  notices: MagicTeaPartyNotice[];
  summary: MagicTeaPartyOutputSummary | null;
  updates: MagicTeaPartyUpdateDraft[] | null;
  updatesMeta: Record<string, unknown> | null;
};

const readString = (value: unknown): string => (typeof value === 'string' ? value : '').trim();

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const readTextField = (payload: any): string => {
  return readString(payload?.text) || readString(payload?.content);
};

const isMarkdownFenceLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
};

const normalizeJsonlLine = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : trimmed;
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
    /\b(type|level|code|message|content|text)\b\s*[:=]\s*("[^"]*"|'[^']*'|`[^`]*`|[^\s]+(?:\s+[^\s]+)*?)(?=\s+\b(?:type|level|code|message|content|text)\b\s*[:=]|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const key = match[1].toLowerCase();
    const value = stripWrappingQuotes(match[2]);
    if (value) pairs[key] = value;
  }
  return pairs;
};

const detectLooseSideChannelHint = (raw: string): 'notice' | 'summary' | 'updates' | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^notice\b/i.test(trimmed) || /\btype\s*[:=]\s*notice\b/i.test(trimmed)) return 'notice';
  if (/^summary\b/i.test(trimmed) || /\btype\s*[:=]\s*summary\b/i.test(trimmed)) return 'summary';
  if (/^(updates?|update)\b/i.test(trimmed) || /\btype\s*[:=]\s*(updates?|update)\b/i.test(trimmed)) return 'updates';
  return null;
};

const parseLooseNoticeFromLine = (raw: string): MagicTeaPartyNotice | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^notice\b/i.test(trimmed) && !/\btype\s*[:=]\s*notice\b/i.test(trimmed)) return null;

  const pairs = parseLooseKeyValuePairs(trimmed);
  const message = pairs.message || pairs.content || pairs.text || '';
  const level = pairs.level || 'info';
  const code = pairs.code || '';

  if (message) {
    const notice = parseMagicTeaPartyNoticePayload({
      type: 'notice',
      level,
      ...(code ? { code } : {}),
      message,
    });
    if (notice) return notice;
  }

  const tail = trimmed.replace(/^notice\b[:\s-]*/i, '').trim();
  if (tail && !/\b(level|code|message|content|text)\b\s*[:=]/i.test(tail)) {
    return parseMagicTeaPartyNoticePayload({
      type: 'notice',
      level: 'info',
      message: tail,
    });
  }

  return null;
};

const tryParseJsonFromLine = (raw: string): unknown | null => {
  const normalized = normalizeJsonlLine(raw);
  if (!normalized) return null;
  try {
    return JSON.parse(normalized);
  } catch {
    const looksJsonLike = /^[\[{]/.test(normalized.trim());
    if (!looksJsonLike) return null;
    try {
      const repaired = jsonrepair(normalized);
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
};

const detectSideChannelHint = (raw: string): 'notice' | 'summary' | 'updates' | null => {
  const normalized = normalizeJsonlLine(raw);
  if (!normalized || !normalized.startsWith('{')) return null;
  const match = normalized.match(/"type"\s*:\s*"(notice|summary|updates|update)"/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  if (type === 'notice') return 'notice';
  if (type === 'summary') return 'summary';
  if (type === 'update' || type === 'updates') return 'updates';
  return null;
};

const buildSideChannelParseNotice = (hint: 'notice' | 'summary' | 'updates'): MagicTeaPartyNotice => {
  const label = hint === 'summary' ? '摘要' : hint === 'updates' ? '更新草案' : 'notice';
  return {
    type: 'notice',
    level: 'warning',
    code: 'jsonl_side_channel_parse_error',
    message: `检测到疑似${label}侧信道行但解析失败，已忽略该行。`,
    meta: { stage: hint },
  };
};

const parseSummaryPayload = (payload: any): MagicTeaPartyOutputSummary | null => {
  const text = readTextField(payload);
  if (!text) return null;
  const sectionsRaw = toRecord(payload?.sections);
  const sections = sectionsRaw
    ? Object.entries(sectionsRaw).reduce<Record<string, string>>((acc, [key, value]) => {
        const sectionText = readString(value);
        if (sectionText) acc[key] = sectionText;
        return acc;
      }, {})
    : undefined;
  return { text, ...(sections && Object.keys(sections).length > 0 ? { sections } : {}) };
};

const parseUpdatesPayload = (
  payload: any
): { drafts: MagicTeaPartyUpdateDraft[]; meta: Record<string, unknown> | null } | null => {
  const draftsRaw: unknown[] | null = Array.isArray(payload?.drafts) ? payload.drafts : null;
  if (!draftsRaw) return null;
  const meta = toRecord(payload?.meta);

  const drafts = draftsRaw
    .map((item: unknown): MagicTeaPartyUpdateDraft | null => {
      const record = toRecord(item);
      if (!record) return null;
      const roleId = readString(record.roleId) || undefined;
      const characterName = readString(record.characterName) || readString(record.character) || readString(record.name);
      if (!characterName) return null;
      const impact = readString(record.impact) || undefined;
      const currentStateSummary =
        readString(record.currentStateSummary) || readString(record.current_state_summary) || undefined;
      const hasWinner = typeof record.hasWinner === 'boolean' ? record.hasWinner : undefined;
      const winner = readString(record.winner) || undefined;
      const draftMeta = toRecord(record.meta);
      const mergedMeta = meta ? { ...(draftMeta ?? {}), ...meta } : draftMeta ?? undefined;
      return {
        ...(roleId ? { roleId } : {}),
        characterName,
        ...(impact ? { impact } : {}),
        ...(currentStateSummary ? { currentStateSummary } : {}),
        ...(typeof hasWinner === 'boolean' ? { hasWinner } : {}),
        ...(winner ? { winner } : {}),
        ...(mergedMeta ? { meta: mergedMeta } : {}),
      };
    })
    .filter((item): item is MagicTeaPartyUpdateDraft => Boolean(item));

  if (drafts.length === 0) return null;
  return { drafts, meta };
};

const appendMagicTeaPartyJsonlLine = (state: MagicTeaPartyJsonlStreamState, raw: string): boolean => {
  const line = raw.trim();
  if (!line) return true;
  if (isMarkdownFenceLine(line)) return true;

  let parsed: any = null;
  parsed = tryParseJsonFromLine(line);
  if (!parsed) {
    const looseNotice = parseLooseNoticeFromLine(raw);
    if (looseNotice) {
      state.notices.push(looseNotice);
      return false;
    }
    const hint = detectSideChannelHint(raw) ?? detectLooseSideChannelHint(raw);
    if (hint) {
      state.notices.push(buildSideChannelParseNotice(hint));
      return false;
    }
    state.segments.push({ type: 'narration', text: raw });
    return true;
  }

  let type = readString(parsed?.type).toLowerCase();
  const notice = parseMagicTeaPartyNoticePayload(parsed);
  if (notice) {
    state.notices.push(notice);
    return false;
  }
  if (!type) {
    if (Array.isArray(parsed?.items) || (parsed?.items && typeof parsed.items === 'object')) type = 'choices';
  }
  if (type === 'summary') {
    const summary = parseSummaryPayload(parsed);
    if (summary) state.summary = summary;
    return false;
  }

  if (type === 'updates' || type === 'update') {
    const updatesPayload = parseUpdatesPayload(parsed);
    if (updatesPayload) {
      state.updates = updatesPayload.drafts;
      state.updatesMeta = updatesPayload.meta;
    }
    return false;
  }

  if (type === 'narration') {
    const narrationText = readTextField(parsed);
    if (narrationText) state.segments.push({ type: 'narration', text: narrationText });
    else state.segments.push({ type: 'narration', text: raw });
    return true;
  }

  if (type === 'dialogue') {
    const speakerId = readString(parsed?.speakerId);
    const speakerName = readString(parsed?.speakerName) || readString(parsed?.speaker) || readString(parsed?.name);
    const dialogueText = readTextField(parsed);
    if (!speakerId || !dialogueText) {
      state.segments.push({ type: 'narration', text: raw });
      return true;
    }
    state.segments.push({
      type: 'dialogue',
      speakerId,
      ...(speakerName ? { speakerName } : {}),
      text: dialogueText,
    });
    return true;
  }

  if (type === 'choices' || type === 'options' || type === 'choice') {
    const itemsValue = parsed?.items;
    const itemsRaw: unknown[] = Array.isArray(itemsValue)
      ? (itemsValue as unknown[])
      : itemsValue && typeof itemsValue === 'object'
        ? Object.entries(itemsValue as Record<string, unknown>).map(([id, text]) => ({ id, text }))
        : typeof itemsValue === 'string'
          ? [itemsValue]
          : [];
    const items = itemsRaw
      .map((item: unknown, index: number): { id: string; text: string } | null => {
        if (typeof item === 'string') {
          const text = item.trim();
          return text ? { id: `c${index + 1}`, text } : null;
        }

        const record = item && typeof item === 'object' ? (item as any) : null;
        const id = readString(record?.id) || `c${index + 1}`;
        const text = readString(record?.text) || readString(record?.content) || readString(record?.label);
        return text ? { id, text } : null;
      })
      .filter((item): item is { id: string; text: string } => Boolean(item));
    if (items.length > 0) {
      state.choices = items;
      state.segments.push({ type: 'choices', items });
    } else {
      state.segments.push({ type: 'narration', text: raw });
    }
    return true;
  }

  state.segments.push({ type: 'narration', text: raw });
  return true;
};

export const createMagicTeaPartyJsonlStreamState = (): MagicTeaPartyJsonlStreamState => ({
  buffer: '',
  segments: [],
  choices: null,
  notices: [],
  summary: null,
  updates: null,
  updatesMeta: null,
});

export const ingestMagicTeaPartyJsonlChunk = (state: MagicTeaPartyJsonlStreamState, chunk: string): void => {
  if (!chunk) return;
  state.buffer += chunk;
  const lines = state.buffer.split('\n');
  state.buffer = lines.pop() ?? '';
  for (const raw of lines) {
    appendMagicTeaPartyJsonlLine(state, raw);
  }
};

export const flushMagicTeaPartyJsonlStream = (state: MagicTeaPartyJsonlStreamState): void => {
  const tail = state.buffer;
  state.buffer = '';
  if (tail.trim()) {
    appendMagicTeaPartyJsonlLine(state, tail);
  }
};

export const parseMagicTeaPartyJsonl = (text: string): ParseResult => {
  const state = createMagicTeaPartyJsonlStreamState();
  const lines = text.split('\n');
  for (const raw of lines) {
    appendMagicTeaPartyJsonlLine(state, raw);
  }
  return {
    segments: state.segments,
    choices: state.choices,
    notices: state.notices,
    summary: state.summary,
    updates: state.updates,
    updatesMeta: state.updatesMeta,
  };
};

export const extractMagicTeaPartySideChannelsFromJsonl = (
  text: string
): {
  cleanedText: string;
  notices: MagicTeaPartyNotice[];
  summary: MagicTeaPartyOutputSummary | null;
  updates: MagicTeaPartyUpdateDraft[] | null;
  updatesMeta: Record<string, unknown> | null;
} => {
  if (!text) {
    return { cleanedText: '', notices: [], summary: null, updates: null, updatesMeta: null };
  }
  const lines = text.split(/\r?\n/);
  const notices: MagicTeaPartyNotice[] = [];
  let summary: MagicTeaPartyOutputSummary | null = null;
  let updates: MagicTeaPartyUpdateDraft[] | null = null;
  let updatesMeta: Record<string, unknown> | null = null;
  const kept: string[] = [];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || isMarkdownFenceLine(trimmed)) {
      kept.push(raw);
      continue;
    }
    let parsed: any = null;
    parsed = tryParseJsonFromLine(trimmed);
    if (!parsed) {
      const looseNotice = parseLooseNoticeFromLine(raw);
      if (looseNotice) {
        notices.push(looseNotice);
        continue;
      }
      const hint = detectSideChannelHint(raw) ?? detectLooseSideChannelHint(raw);
      if (hint) {
        notices.push(buildSideChannelParseNotice(hint));
        continue;
      }
      kept.push(raw);
      continue;
    }

    const notice = parseMagicTeaPartyNoticePayload(parsed);
    if (notice) {
      notices.push(notice);
      continue;
    }

    const type = readString(parsed?.type).toLowerCase();
    if (type === 'summary') {
      const parsedSummary = parseSummaryPayload(parsed);
      if (parsedSummary) summary = parsedSummary;
      continue;
    }

    if (type === 'updates' || type === 'update') {
      const parsedUpdates = parseUpdatesPayload(parsed);
      if (parsedUpdates) {
        updates = parsedUpdates.drafts;
        updatesMeta = parsedUpdates.meta;
      }
      continue;
    }

    kept.push(raw);
  }

  return {
    cleanedText: kept.join('\n'),
    notices,
    summary,
    updates,
    updatesMeta,
  };
};
