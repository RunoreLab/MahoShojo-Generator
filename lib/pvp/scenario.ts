import type { PvpScenarioSelection } from '@/lib/pvp/types';

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const parsePvpScenarioSelection = (raw: unknown): PvpScenarioSelection | null => {
  if (!isRecord(raw)) return null;

  const contentRaw = raw.content;
  if (!isRecord(contentRaw)) return null;

  const fileNameRaw = typeof raw.fileName === 'string' ? raw.fileName.trim() : '';
  const fallbackTitle = typeof contentRaw.title === 'string' ? contentRaw.title.trim() : '';
  const fileName = fileNameRaw || (fallbackTitle ? `${fallbackTitle}.json` : '');
  if (!fileName) return null;
  if (fileName.length > 256) return null;

  const sourceDataCardId = typeof raw.sourceDataCardId === 'string' ? raw.sourceDataCardId.trim() : '';
  const sourceDataCardUpdatedAt = typeof raw.sourceDataCardUpdatedAt === 'string' ? raw.sourceDataCardUpdatedAt.trim() : '';
  const sourceDataCardName = typeof raw.sourceDataCardName === 'string' ? raw.sourceDataCardName.trim() : '';
  const sourceIsPublic =
    typeof raw.sourceIsPublic === 'boolean'
      ? raw.sourceIsPublic
      : (typeof raw.sourceIsPublic === 'number' ? raw.sourceIsPublic === 1 : null);
  const sourceAuthor = typeof raw.sourceAuthor === 'string' ? raw.sourceAuthor.trim() : '';

  const isNative = typeof raw.isNative === 'boolean' ? raw.isNative : undefined;

  return {
    content: contentRaw,
    fileName,
    ...(isNative !== undefined ? { isNative } : {}),
    ...(sourceDataCardId ? { sourceDataCardId } : {}),
    ...(sourceDataCardUpdatedAt ? { sourceDataCardUpdatedAt } : {}),
    ...(sourceDataCardName ? { sourceDataCardName } : {}),
    ...(sourceIsPublic === null ? {} : { sourceIsPublic }),
    ...(sourceAuthor ? { sourceAuthor } : {}),
  };
};

export const getPvpScenarioTitle = (selection: PvpScenarioSelection): string | null => {
  if (selection.sourceDataCardName) return selection.sourceDataCardName;
  const title = typeof selection.content.title === 'string' ? selection.content.title.trim() : '';
  if (title) return title;
  const fileName = selection.fileName.trim();
  if (!fileName) return null;
  return fileName.replace(/\.json$/i, '');
};

