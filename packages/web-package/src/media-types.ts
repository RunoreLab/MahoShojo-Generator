/**
 * Extension → media type for derived file tables.
 *
 * Shared by preset generation and ZIP import so both sides fail closed on the
 * same set: an asset the generator cannot describe is an asset the importer
 * refuses to guess. Extending supported media formats means editing this map.
 */
export const WEB_PACKAGE_MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
});

const extensionOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

/** Undefined means "not derivable"; callers must fail closed rather than default. */
export const resolveWebPackageMediaType = (path: string): string | undefined =>
  WEB_PACKAGE_MEDIA_TYPES[extensionOf(path)];

export const WEB_PACKAGE_MEDIA_TYPE_EXTENSIONS: readonly string[] =
  Object.keys(WEB_PACKAGE_MEDIA_TYPES).sort();
