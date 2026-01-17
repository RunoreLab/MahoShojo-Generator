import type {
  MagicTeaPartyNotice,
  MagicTeaPartyOutputSegment,
  MagicTeaPartyOutputSummary,
  MagicTeaPartyUpdateDraft,
} from '@/lib/magic-tea-party/types';
import { parseMagicTeaPartyNoticePayload } from '@/lib/magic-tea-party/notice';

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
  try {
    const normalized = line.startsWith('data:') ? line.slice('data:'.length).trim() : line;
    parsed = JSON.parse(normalized);
  } catch {
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
    const normalized = trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : trimmed;
    let parsed: any = null;
    try {
      parsed = JSON.parse(normalized);
    } catch {
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
