import type { PvpScenarioSelection } from '@/lib/pvp/types';
import { getScenarioPresetByFilename } from '@/lib/scenario-presets';

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const parsePvpScenarioSelection = (raw: unknown): PvpScenarioSelection | null => {
  if (!isRecord(raw)) return null;

  const kindRaw = typeof raw.kind === 'string' ? raw.kind.trim() : '';
  if (kindRaw && kindRaw !== 'data_card' && kindRaw !== 'preset') return null;

  if (kindRaw === 'preset') {
    const filenameRaw =
      (typeof raw.filename === 'string' ? raw.filename.trim() : '') ||
      (typeof (raw as any).presetFilename === 'string' ? String((raw as any).presetFilename).trim() : '');
    if (!filenameRaw) return null;
    if (filenameRaw.length > 128) return null;

    const preset = getScenarioPresetByFilename(filenameRaw);
    if (!preset) return null;

    const nameRaw =
      (typeof raw.name === 'string' ? raw.name.trim() : '') ||
      (typeof (raw as any).title === 'string' ? String((raw as any).title).trim() : '');
    const name = nameRaw || preset.title || null;

    return {
      kind: 'preset',
      filename: preset.filename,
      name,
    };
  }

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
  if (selection.kind === 'preset') {
    const filename = typeof selection.filename === 'string' ? selection.filename.trim() : '';
    return filename || null;
  }
  const id = typeof selection.id === 'string' ? selection.id.trim() : '';
  return id || null;
};
