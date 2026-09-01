import { z } from './zod';

import {
  LocalCardContentDigestSchema,
  LocalCardIdSchema,
  LocalCardSchemaVersionSchema,
  Sha256ChecksumSchema,
} from './record';

export const LOCAL_LIBRARY_ARCHIVE_FORMAT = 'mahoshojo-local-library' as const;
export const LOCAL_LIBRARY_ARCHIVE_FORMAT_VERSION = 1 as const;
export const MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES = 100_000 as const;

const IsoTimestampSchema = z.string().datetime({ offset: true });
const ArchiveByteLengthSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const WindowsReservedFileStemSchema = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/u;
const CardArchivePathSchema = z
  .string()
  .regex(/^cards\/[a-z0-9][a-z0-9._-]{0,127}\.json$/u, 'must be a lowercase safe cards/*.json path')
  .superRefine((path, context) => {
    const fileStem = path.slice('cards/'.length, -'.json'.length);
    if (fileStem.endsWith('.') || WindowsReservedFileStemSchema.test(fileStem)) {
      context.addIssue({ code: 'custom', message: 'card path must be portable across supported filesystems' });
    }
  });
const AssetArchivePathSchema = z
  .string()
  .regex(/^assets\/[0-9a-f]{64}(?:\.[a-z0-9]{1,16})?$/u, 'must be a lowercase content-addressed asset path');

export const LocalLibraryArchiveCardEntryV1Schema = z
  .object({
    cardId: LocalCardIdSchema,
    path: CardArchivePathSchema,
    contentDigest: LocalCardContentDigestSchema,
    /** SHA-256 over the exact UTF-8 bytes stored at path. */
    checksum: Sha256ChecksumSchema,
    byteLength: ArchiveByteLengthSchema,
  })
  .strict();
export type LocalLibraryArchiveCardEntryV1 = z.infer<typeof LocalLibraryArchiveCardEntryV1Schema>;

export const LocalLibraryArchiveAssetEntryV1Schema = z
  .object({
    path: AssetArchivePathSchema,
    contentDigest: Sha256ChecksumSchema,
    /** SHA-256 over the exact asset bytes stored at path. */
    checksum: Sha256ChecksumSchema,
    byteLength: ArchiveByteLengthSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    const digest = entry.contentDigest.slice('sha256:'.length);
    if (entry.checksum !== entry.contentDigest) {
      context.addIssue({
        code: 'custom',
        path: ['checksum'],
        message: 'asset checksum must match contentDigest',
      });
    }
    if (!entry.path.startsWith(`assets/${digest}`)) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'asset path must be derived from contentDigest',
      });
    }
  });
export type LocalLibraryArchiveAssetEntryV1 = z.infer<typeof LocalLibraryArchiveAssetEntryV1Schema>;

export const LocalLibraryArchiveManifestV1Schema = z
  .object({
    format: z.literal(LOCAL_LIBRARY_ARCHIVE_FORMAT),
    formatVersion: z.literal(LOCAL_LIBRARY_ARCHIVE_FORMAT_VERSION),
    librarySchemaVersion: LocalCardSchemaVersionSchema,
    exportedAt: IsoTimestampSchema,
    cardCount: z.number().int().nonnegative().max(MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES),
    assetCount: z.number().int().nonnegative().max(MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES),
    cards: z.array(LocalLibraryArchiveCardEntryV1Schema).max(MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES),
    assets: z.array(LocalLibraryArchiveAssetEntryV1Schema).max(MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.cardCount !== manifest.cards.length) {
      context.addIssue({ code: 'custom', path: ['cardCount'], message: 'cardCount must match cards length' });
    }
    if (manifest.assetCount !== manifest.assets.length) {
      context.addIssue({ code: 'custom', path: ['assetCount'], message: 'assetCount must match assets length' });
    }

    const cardIds = new Set<string>();
    const paths = new Set<string>();
    manifest.cards.forEach((entry, index) => {
      if (cardIds.has(entry.cardId)) {
        context.addIssue({ code: 'custom', path: ['cards', index, 'cardId'], message: 'cardId must be unique' });
      }
      cardIds.add(entry.cardId);
      if (paths.has(entry.path)) {
        context.addIssue({ code: 'custom', path: ['cards', index, 'path'], message: 'archive path must be unique' });
      }
      paths.add(entry.path);
    });
    manifest.assets.forEach((entry, index) => {
      if (paths.has(entry.path)) {
        context.addIssue({ code: 'custom', path: ['assets', index, 'path'], message: 'archive path must be unique' });
      }
      paths.add(entry.path);
    });
  });
export type LocalLibraryArchiveManifestV1 = z.infer<typeof LocalLibraryArchiveManifestV1Schema>;

export const LocalLibraryArchiveManifestSchema = LocalLibraryArchiveManifestV1Schema;
export type LocalLibraryArchiveManifest = LocalLibraryArchiveManifestV1;
