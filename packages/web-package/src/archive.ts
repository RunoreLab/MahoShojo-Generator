import { unzipSync } from 'fflate';
import { WebPackagePathSchema } from '@mahoshojo/contracts/web-package';

/**
 * Archive-envelope normalization. This layer is deliberately forgiving about
 * *packaging* and strict about *content*: it resolves where the package starts
 * and which entries are files, but never invents, rewrites or drops a declared
 * payload file. Manifest semantics live in ./import.
 */

export type ArchiveEntry = Readonly<{ path: string; bytes: Uint8Array }>;

export type ArchiveNormalization = Readonly<{
  /** Root-relative logical paths, sorted; directory placeholders and archive metadata removed. */
  files: readonly ArchiveEntry[];
  /** Wrapper directory that was stripped, or '' when the archive is already root-layout. */
  root: string;
  /** Archive-tool metadata dropped, for user-facing reporting. */
  dropped: readonly string[];
}>;

/**
 * Archive-tool metadata is never package content. Dropped by fixed name (and
 * the `__MACOSX/` tree), never by "ignore unknown prefixes" — any other stray
 * entry stays an error so the file table can never disagree with the archive.
 */
const ARCHIVE_METADATA_NAMES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const ARCHIVE_METADATA_DIRECTORY = '__MACOSX/';

/**
 * Decompression safety bound, NOT a product package-size limit (see
 * packages/web-package/README.md). fflate pre-allocates `new Uint8Array(originalSize)`
 * from the central directory before inflating, so a forged size field is a
 * direct memory-exhaustion vector; this bounds expansion work during import.
 */
export const MAX_ARCHIVE_EXPANDED_BYTES = 256 * 1024 * 1024;

/**
 * Entry-count bound, same category as {@link MAX_ARCHIVE_EXPANDED_BYTES} and for
 * the same reason: it limits decompression *work*, not product package size.
 *
 * It closes a vector the byte budget structurally cannot see. A 64 MiB archive of
 * empty entries costs ~60 bytes each in headers, so it carries a declared
 * expansion total of **zero** while still making `unzipSync` allocate ~1M result
 * objects, and then making normalization build ~1M path strings. OWASP ASVS V5.2.3
 * asks for a maximum file count in addition to a maximum decompressed size
 * precisely because one does not imply the other.
 *
 * 4096 is far above any hand-authored package (tens to hundreds of files) and
 * far below anything that stresses the process. It counts every entry fflate
 * offers, including directory placeholders and archive-tool metadata, because
 * the work is incurred before any of that is discarded.
 */
export const MAX_ARCHIVE_ENTRIES = 4096;

export const isArchiveMetadataPath = (path: string): boolean => (
  path.startsWith(ARCHIVE_METADATA_DIRECTORY)
  || ARCHIVE_METADATA_NAMES.has(path.slice(path.lastIndexOf('/') + 1))
);

/** `dir/` is only archive metadata when a real package file lives under it. */
const isRequiredDirectoryPlaceholder = (path: string, files: readonly ArchiveEntry[]): boolean => {
  const directory = path.slice(0, -1);
  return files.some((file) => file.path.startsWith(directory) && file.path.length > directory.length
    && file.path.charAt(directory.length) === '/');
};

const splitRootRelative = (path: string, root: string): string | null => {
  if (!root) return path;
  if (!path.startsWith(`${root}/`)) return null;
  return path.slice(root.length + 1);
};

/**
 * Resolve the package root inside the archive. Prefers a root-layout manifest,
 * then accepts exactly one single-segment wrapper directory — the shape every
 * common ZIP tool produces. Never guesses among several candidates.
 *
 * An archive with no manifest anywhere is imported whole: without a manifest
 * there is no authority for where the package starts, so guessing a wrapper
 * would silently rewrite author paths. A manifest buried deeper than one level
 * is a packaging mistake worth naming, not silently treating as payload.
 */
const resolveArchiveRoot = (
  files: readonly ArchiveEntry[],
  manifestPath: string,
  input: Pick<NormalizeArchiveInput, 'ambiguousRoot' | 'nestedManifest'>,
): string => {
  if (files.some((file) => file.path === manifestPath)) return '';
  const manifestSuffix = `/${manifestPath}`;
  const candidates = [...new Set(files
    .map((file) => file.path.split('/'))
    .filter((parts) => parts.length === 2 && parts[1] === manifestPath)
    .map((parts) => parts[0]!))].sort();
  if (candidates.length > 1) throw input.ambiguousRoot(candidates);
  if (candidates.length === 1) {
    const [root] = candidates as [string];
    if (!WebPackagePathSchema.safeParse(root).success) throw input.ambiguousRoot([root]);
    return root;
  }
  const nested = files.find((file) => file.path.split('/').length > 2 && file.path.endsWith(manifestSuffix));
  if (nested) throw input.nestedManifest(nested.path, manifestPath);
  return '';
};

export type NormalizeArchiveInput = Readonly<{
  entries: Readonly<Record<string, Uint8Array>>;
  manifestPath: string;
  ambiguousRoot: (_candidates: readonly string[]) => Error;
  nestedManifest: (_path: string, _manifestPath: string) => Error;
  fileOutsideRoot: (_path: string, _root: string) => Error;
  invalidPath: (_path: string) => Error;
  strayEntry: (_path: string) => Error;
  directoryNotEmpty: (_path: string) => Error;
}>;

/**
 * Unpack, drop archive metadata, resolve the package root and validate logical
 * paths. Payload files are returned untouched; nothing here is content-aware.
 */
export const normalizeWebPackageArchive = (input: NormalizeArchiveInput): ArchiveNormalization => {
  const dropped: string[] = [];
  const payload: ArchiveEntry[] = [];
  const placeholders: string[] = [];
  for (const [path, bytes] of Object.entries(input.entries)) {
    if (isArchiveMetadataPath(path)) { dropped.push(path); continue; }
    if (path.endsWith('/')) {
      if (bytes.byteLength > 0) throw input.directoryNotEmpty(path);
      placeholders.push(path);
      continue;
    }
    payload.push({ path, bytes });
  }

  const root = resolveArchiveRoot(payload, input.manifestPath, input);
  const files: ArchiveEntry[] = [];
  for (const entry of payload) {
    const relative = splitRootRelative(entry.path, root);
    if (relative === null) throw input.fileOutsideRoot(entry.path, root);
    const parsed = WebPackagePathSchema.safeParse(relative);
    if (!parsed.success) throw input.invalidPath(relative);
    files.push({ path: relative, bytes: entry.bytes });
  }
  // Segment-aware: `assetsX/` is not a required placeholder for `assets/foo.png`.
  for (const placeholder of placeholders) {
    const relative = root ? splitRootRelative(placeholder, root) : placeholder;
    if (relative !== null && relative !== '' && !isRequiredDirectoryPlaceholder(relative, files)) {
      throw input.strayEntry(placeholder);
    }
  }
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { files, root, dropped: dropped.sort() };
};

/**
 * Expand an archive under a decompression budget.
 *
 * Three separate guards, because `unzipSync` trusts the central directory in
 * three separate ways:
 *
 * 1. **Declared expansion total.** fflate pre-allocates
 *    `new Uint8Array(originalSize)` before inflating, so the total is summed to
 *    bound that allocation.
 * 2. **Entry count.** `originalSize` is attacker-controlled and can be declared
 *    as 0 for every entry, which makes guard 1 read 0 while the archive still
 *    carries a million entries. See {@link MAX_ARCHIVE_ENTRIES}.
 * 3. **Delivered length matches declared length.** `unzipSync` does not read
 *    sizes from one place, and the two behaviours diverge in *opposite*
 *    directions. Measured with a 100-byte entry re-declared as 92:
 *
 *    - stored (level 0): `filter.originalSize` reports 92 (central directory)
 *      while the delivered payload is **100** bytes -- the local header wins, so
 *      fflate can allocate and emit more than guard 1 accounted for. This is the
 *      memory-safety direction, and guard 3 is what catches it.
 *    - deflated (level 6): the delivered payload is **92** bytes and no error is
 *      raised, so the archive silently yields a truncated file. Guard 3 cannot
 *      see this one (declared == delivered by construction); it surfaces later as
 *      a manifest file-digest mismatch, whose diagnostic points at package
 *      content rather than at a malformed archive.
 *
 *    Either way the archive's two size declarations disagree, which is worth
 *    rejecting explicitly: guard 3 turns "proceed and find out later" into a
 *    named failure at the point where the inconsistency actually lives.
 *
 * fflate treats a rejected filter as "skip this entry" and returns a partial
 * archive rather than failing, so every guard is decided after the call instead
 * of relying on an exception.
 */
export const expandWebPackageArchive = (
  archive: Uint8Array,
  onLimitExceeded: {
    expandedOverflow: (_limit: number) => Error;
    entryCountOverflow: (_limit: number) => Error;
    entryLengthMismatch: (_path: string, _declared: number, _delivered: number) => Error;
  },
): Record<string, Uint8Array> => {
  let expanded = 0;
  let seen = 0;
  let expandedOverflowed = false;
  let entryCountOverflowed = false;
  const declared = new Map<string, number>();
  const entries = unzipSync(archive, {
    filter: ({ name, originalSize }) => {
      seen += 1;
      if (seen > MAX_ARCHIVE_ENTRIES) { entryCountOverflowed = true; return false; }
      declared.set(name, originalSize ?? 0);
      expanded += originalSize ?? 0;
      if (expanded > MAX_ARCHIVE_EXPANDED_BYTES) { expandedOverflowed = true; return false; }
      return true;
    },
  });
  // Entry count is reported first: once the count is over the limit the byte
  // total is untrustworthy, so the diagnostic has to name the real cause.
  if (entryCountOverflowed) throw onLimitExceeded.entryCountOverflow(MAX_ARCHIVE_ENTRIES);
  if (expandedOverflowed) throw onLimitExceeded.expandedOverflow(MAX_ARCHIVE_EXPANDED_BYTES);
  for (const [path, bytes] of Object.entries(entries)) {
    const expected = declared.get(path);
    if (expected !== undefined && bytes.byteLength !== expected) {
      throw onLimitExceeded.entryLengthMismatch(path, expected, bytes.byteLength);
    }
  }
  return entries;
};
