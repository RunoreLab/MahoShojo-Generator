import type { MagicTavernOutputSegment } from '@/lib/magic-tavern/types';

type ParseResult = {
  segments: MagicTavernOutputSegment[];
  choices: { id: string; text: string }[] | null;
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

export const parseMagicTavernJsonl = (text: string): ParseResult => {
  const segments: MagicTavernOutputSegment[] = [];
  let choices: { id: string; text: string }[] | null = null;

  const lines = text.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isMarkdownFenceLine(line)) continue;

    let parsed: any = null;
    try {
      const normalized = line.startsWith('data:') ? line.slice('data:'.length).trim() : line;
      parsed = JSON.parse(normalized);
    } catch {
      segments.push({ type: 'narration', text: raw });
      continue;
    }

    let type = readString(parsed?.type).toLowerCase();
    if (!type) {
      if (Array.isArray(parsed?.items) || (parsed?.items && typeof parsed.items === 'object')) type = 'choices';
    }
    if (type === 'narration') {
      const narrationText = readTextField(parsed);
      if (narrationText) segments.push({ type: 'narration', text: narrationText });
      else segments.push({ type: 'narration', text: raw });
      continue;
    }

    if (type === 'dialogue') {
      const speakerId = readString(parsed?.speakerId);
      const speakerName = readString(parsed?.speakerName) || readString(parsed?.speaker) || readString(parsed?.name);
      const dialogueText = readTextField(parsed);
      if (!speakerId || !dialogueText) {
        segments.push({ type: 'narration', text: raw });
        continue;
      }
      segments.push({
        type: 'dialogue',
        speakerId,
        ...(speakerName ? { speakerName } : {}),
        text: dialogueText,
      });
      continue;
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
        choices = items;
        segments.push({ type: 'choices', items });
      } else {
        segments.push({ type: 'narration', text: raw });
      }
      continue;
    }

    segments.push({ type: 'narration', text: raw });
  }

  return { segments, choices };
};
