import { mapDeckReadRow, mapDeckReadRows, type DeckReadDto } from '@/lib/deck-read-mappers';

type DeckListPayload = {
  decks: DeckReadDto[];
  capacity?: number;
  deckCount?: number;
};

type DeckDetailPayload = {
  deck: DeckReadDto;
  cards: any[];
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readInt = (source: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = source[key];
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(numeric)) return Math.max(0, Math.floor(numeric));
  }
  return undefined;
};

export const mapDeckListPayload = (payload: unknown): DeckListPayload => {
  if (Array.isArray(payload)) {
    return { decks: mapDeckReadRows(payload) };
  }

  const source = toRecord(payload);
  if (!source) return { decks: [] };

  const decks = mapDeckReadRows(source.decks);
  const capacity = readInt(source, ['capacity']);
  const deckCount = readInt(source, ['deckCount', 'deck_count']);

  return {
    decks,
    ...(capacity !== undefined ? { capacity } : {}),
    ...(deckCount !== undefined ? { deckCount } : {}),
  };
};

export const mapDeckDetailPayload = (payload: unknown): DeckDetailPayload | null => {
  const source = toRecord(payload);
  if (!source) return null;
  if (!toRecord(source.deck)) return null;

  return {
    deck: mapDeckReadRow(source.deck),
    cards: Array.isArray(source.cards) ? source.cards : [],
  };
};
