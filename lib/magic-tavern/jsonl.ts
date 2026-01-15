import type { MagicTavernOutputSegment } from '@/lib/magic-tavern/types';

type ParseResult = {
  segments: MagicTavernOutputSegment[];
  choices: { id: string; text: string }[] | null;
};

const readString = (value: unknown): string => (typeof value === 'string' ? value : '').trim();

export const parseMagicTavernJsonl = (text: string): ParseResult => {
  const segments: MagicTavernOutputSegment[] = [];
  let choices: { id: string; text: string }[] | null = null;

  const lines = text.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let parsed: any = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      segments.push({ type: 'narration', text: raw });
      continue;
    }

    const type = readString(parsed?.type);
    if (type === 'narration') {
      const narrationText = readString(parsed?.text);
      if (narrationText) segments.push({ type: 'narration', text: narrationText });
      continue;
    }

    if (type === 'dialogue') {
      const speakerId = readString(parsed?.speakerId);
      const speakerName = readString(parsed?.speakerName);
      const dialogueText = readString(parsed?.text);
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

    if (type === 'choices') {
      const itemsRaw: unknown[] = Array.isArray(parsed?.items) ? (parsed.items as unknown[]) : [];
      const items = itemsRaw
        .map((item: unknown, index: number): { id: string; text: string } | null => {
          const record = item && typeof item === 'object' ? (item as any) : null;
          const id = readString(record?.id) || `c${index + 1}`;
          const text = readString(record?.text);
          return text ? { id, text } : null;
        })
        .filter((item): item is { id: string; text: string } => Boolean(item));
      if (items.length > 0) {
        choices = items;
        segments.push({ type: 'choices', items });
      }
      continue;
    }

    segments.push({ type: 'narration', text: raw });
  }

  return { segments, choices };
};
