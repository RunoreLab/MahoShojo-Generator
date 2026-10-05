/**
 * Extension → media type for derived file tables.
 *
 * Shared by preset generation and ZIP import so both sides describe the same
 * assets. The map is a *description convenience*, not an enforcement boundary:
 * the renderer is the layer that actually refuses to run a file whose media
 * type is not executable JavaScript, so a format the map does not know must not
 * block import — it is described as an opaque binary and reported to the user.
 * Extending supported media formats means editing this map.
 */
export const WEB_PACKAGE_MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/vnd.microsoft.icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wasm': 'application/wasm',
  '.vtt': 'text/vtt',
  '.pdf': 'application/pdf',
});

/** Descriptor value for a file the map cannot describe: inert in every consumer. */
export const WEB_PACKAGE_OPAQUE_MEDIA_TYPE = 'application/octet-stream';

const extensionOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

/** Undefined means "not derivable from the name"; callers must not silently default. */
export const resolveWebPackageMediaType = (path: string): string | undefined =>
  WEB_PACKAGE_MEDIA_TYPES[extensionOf(path)];

export const WEB_PACKAGE_MEDIA_TYPE_EXTENSIONS: readonly string[] =
  Object.keys(WEB_PACKAGE_MEDIA_TYPES).sort();

/**
 * Whether text scanning of this media type could be skipped without losing
 * coverage. A package may declare any media type, so the scanner uses this
 * allowlist (not the declared type) to decide which files are known-binary:
 * a text file mislabelled `image/png` is still scanned.
 */
const SCAN_OPAQUE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/zip',
  'application/gzip',
  'application/wasm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/mp4',
  'audio/flac',
  'font/woff',
  'font/woff2',
  'font/ttf',
  'font/otf',
  'application/vnd.ms-fontobject',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/vnd.microsoft.icon',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

export const isWebPackageBinaryMediaType = (type: string): boolean =>
  SCAN_OPAQUE_MEDIA_TYPES.has(type);
