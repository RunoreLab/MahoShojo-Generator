import type { MagicTeaPartyNotice, MagicTeaPartyOutputSegment } from '@/lib/magic-tea-party/types';
import { parseMagicTeaPartyNoticePayload } from '@/lib/magic-tea-party/notice';

type ParseResult = {
  segments: MagicTeaPartyOutputSegment[];
  choices: { id: string; text: string }[] | null;
  notices: MagicTeaPartyNotice[];
};

export type MagicTeaPartyJsonlStreamState = {
  buffer: string;
  segments: MagicTeaPartyOutputSegment[];
  choices: { id: string; text: string }[] | null;
  notices: MagicTeaPartyNotice[];
};

const readString = (value: unknown): string => (typeof value === 'string' ? value : '').trim();

const readTextField = (payload: any): string => {
  return readString(payload?.text) || readString(payload?.content);
};

const isMarkdownFenceLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
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
  return { segments: state.segments, choices: state.choices, notices: state.notices };
};
