import type { PvpScenarioSelection } from '@/lib/pvp/types';

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const parsePvpScenarioSelection = (raw: unknown): PvpScenarioSelection | null => {
  if (!isRecord(raw)) return null;

  const kindRaw = typeof raw.kind === 'string' ? raw.kind.trim() : '';
  if (kindRaw && kindRaw !== 'data_card') return null;

  const id =
    (typeof raw.id === 'string' ? raw.id.trim() : '') ||
    (typeof raw.sourceDataCardId === 'string' ? raw.sourceDataCardId.trim() : '');
  if (!id) return null;
  if (id.length > 128) return null;

  const updatedAtRaw =
    (typeof raw.updatedAt === 'string' ? raw.updatedAt.trim() : '') ||
    (typeof raw.sourceDataCardUpdatedAt === 'string' ? raw.sourceDataCardUpdatedAt.trim() : '');
  const updatedAt = updatedAtRaw || null;

  const nameRaw =
    (typeof raw.name === 'string' ? raw.name.trim() : '') ||
    (typeof raw.sourceDataCardName === 'string' ? raw.sourceDataCardName.trim() : '');
  const name = nameRaw || null;

  const isPublicRaw = raw.isPublic ?? raw.sourceIsPublic;
  const isPublic =
    typeof isPublicRaw === 'boolean'
      ? isPublicRaw
      : (typeof isPublicRaw === 'number' ? isPublicRaw === 1 : null);

  const authorRaw =
    (typeof raw.author === 'string' ? raw.author.trim() : '') ||
    (typeof raw.sourceAuthor === 'string' ? raw.sourceAuthor.trim() : '');
  const author = authorRaw || null;

  return {
    kind: 'data_card',
    id,
    updatedAt,
    name,
    isPublic,
    author,
  };
};

export const getPvpScenarioTitle = (selection: PvpScenarioSelection): string | null => {
  const name = typeof selection.name === 'string' ? selection.name.trim() : '';
  if (name) return name;
  const id = typeof selection.id === 'string' ? selection.id.trim() : '';
  return id || null;
};
