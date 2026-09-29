import {
  LocalWebPackageArchiveSchema,
  LocalWebPackageRecordV1Schema,
} from '@mahoshojo/local-library/web-package-record';

import { createLocalWebPackageRecord, createWebPackageManifest } from './web-package-fixtures';

const DIGEST = `sha256:${'b'.repeat(64)}`;

describe('LocalWebPackageRecordV1', () => {
  it('accepts a locally owned package whose content digest is its ref digest', () => {
    const record = createLocalWebPackageRecord();
    expect(LocalWebPackageRecordV1Schema.parse(record)).toEqual(record);
  });

  it('refuses a record whose content digest drifts from the package identity', () => {
    const result = LocalWebPackageRecordV1Schema.safeParse(createLocalWebPackageRecord({
      contentDigest: `sha256:${'c'.repeat(64)}`,
    }));
    expect(result.success).toBe(false);
  });

  it('refuses cloud storage, unknown entity kinds, and manifest-shaped drift', () => {
    expect(LocalWebPackageRecordV1Schema.safeParse({
      ...createLocalWebPackageRecord(),
      storageLocation: 'cloud',
    }).success).toBe(false);
    expect(LocalWebPackageRecordV1Schema.safeParse({
      ...createLocalWebPackageRecord(),
      entityKind: 'data-card',
    }).success).toBe(false);
    // The manifest is not free-form: a placeholder entry would smuggle in a package the
    // host can never resolve, so the embedded contract must be re-validated here too.
    expect(LocalWebPackageRecordV1Schema.safeParse(createLocalWebPackageRecord({
      manifest: createWebPackageManifest({ entry: 'missing.html' }),
    })).success).toBe(false);
  });

  it('rejects unknown fields and out-of-order timestamps', () => {
    expect(LocalWebPackageRecordV1Schema.safeParse({
      ...createLocalWebPackageRecord(),
      slotCount: 1,
    }).success).toBe(false);
    expect(LocalWebPackageRecordV1Schema.safeParse(createLocalWebPackageRecord({
      updatedAt: '2026-09-29T11:00:00.000Z',
    })).success).toBe(false);
    expect(LocalWebPackageRecordV1Schema.safeParse(createLocalWebPackageRecord({
      deletedAt: '2026-09-29T11:00:00.000Z',
    })).success).toBe(false);
  });

  it('returns a defensive copy of the manifest after validation', () => {
    const record = createLocalWebPackageRecord();
    const parsed = LocalWebPackageRecordV1Schema.parse(record);
    parsed.manifest.name = '被调用方改写';
    expect(record.manifest.name).toBe('本地库测试包');
  });
});

describe('LocalWebPackageArchive', () => {
  it('accepts binary payloads from any realm, not just this one', () => {
    expect(LocalWebPackageArchiveSchema.safeParse({
      digest: DIGEST,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      cachedAt: '2026-09-29T12:00:00.000Z',
    }).success).toBe(true);
    expect(LocalWebPackageArchiveSchema.safeParse({
      digest: DIGEST,
      bytes: new Uint8Array([1, 2, 3]),
      cachedAt: '2026-09-29T12:00:00.000Z',
    }).success).toBe(true);
  });

  it('rejects non-binary payloads and un-tagged digests', () => {
    expect(LocalWebPackageArchiveSchema.safeParse({
      digest: DIGEST,
      bytes: 'a zip would be binary',
      cachedAt: '2026-09-29T12:00:00.000Z',
    }).success).toBe(false);
    expect(LocalWebPackageArchiveSchema.safeParse({
      digest: 'not-tagged',
      bytes: new Uint8Array([1]).buffer,
      cachedAt: '2026-09-29T12:00:00.000Z',
    }).success).toBe(false);
  });
});
