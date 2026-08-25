export const getDecodedPathParamAfterSegment = (
  rawUrl: string,
  segment: string,
): string | null => {
  const normalizedSegment = typeof segment === 'string' ? segment.trim() : '';
  if (!normalizedSegment) return null;

  try {
    const parts = new URL(rawUrl).pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === normalizedSegment);
    if (idx === -1) return null;

    const encoded = parts[idx + 1];
    if (!encoded) return null;

    const decoded = decodeURIComponent(encoded);
    if (!decoded || decoded.includes('/')) return null;
    return decoded;
  } catch {
    return null;
  }
};

