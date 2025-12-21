export const getPathSegments = (url: string): string[] => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
};

export const getRoomIdFromRequestUrl = (url: string): string | null => {
  const segments = getPathSegments(url);
  const roomsIndex = segments.findIndex((s) => s === 'rooms');
  if (roomsIndex < 0) return null;
  return segments[roomsIndex + 1] ?? null;
};

export const getRoundIdFromRequestUrl = (url: string): string | null => {
  const segments = getPathSegments(url);
  const roundsIndex = segments.findIndex((s) => s === 'rounds');
  if (roundsIndex < 0) return null;
  return segments[roundsIndex + 1] ?? null;
};

