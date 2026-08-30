import {
  LocalLibraryArchiveManifestV1Schema,
} from '@mahoshojo/local-library/archive';

describe('LocalLibraryArchiveManifestV1', () => {
  const cardChecksum = `sha256:${'b'.repeat(64)}`;
  const assetChecksum = `sha256:${'c'.repeat(64)}`;
  const createManifest = () => ({
    format: 'mahoshojo-local-library',
    formatVersion: 1,
    librarySchemaVersion: 1,
    exportedAt: '2026-08-23T13:00:00.000Z',
    cardCount: 1,
    assetCount: 1,
    cards: [{
      cardId: 'local-card-1',
      path: 'cards/local-card-1.json',
      contentDigest: `sha256:${'a'.repeat(64)}`,
      checksum: cardChecksum,
      byteLength: 1024,
    }],
    assets: [{
      path: `assets/${'c'.repeat(64)}.png`,
      contentDigest: assetChecksum,
      checksum: assetChecksum,
      byteLength: 2048,
    }],
  });

  it('round-trips a versioned, checksummed manifest using JSON only', () => {
    const manifest = LocalLibraryArchiveManifestV1Schema.parse(createManifest());
    expect(LocalLibraryArchiveManifestV1Schema.parse(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it('rejects traversal paths, duplicate entries, and mismatched counts', () => {
    expect(LocalLibraryArchiveManifestV1Schema.safeParse({
      ...createManifest(),
      cards: [{ ...createManifest().cards[0], path: 'cards/../secret.json' }],
    }).success).toBe(false);
    expect(LocalLibraryArchiveManifestV1Schema.safeParse({
      ...createManifest(),
      cards: [{ ...createManifest().cards[0], path: 'cards/LOCAL-card-1.json' }],
    }).success).toBe(false);
    for (const path of ['cards/con.json', 'cards/con.txt.json', 'cards/card-name..json']) {
      expect(LocalLibraryArchiveManifestV1Schema.safeParse({
        ...createManifest(),
        cards: [{ ...createManifest().cards[0], path }],
      }).success).toBe(false);
    }
    expect(LocalLibraryArchiveManifestV1Schema.safeParse({
      ...createManifest(),
      cardCount: 2,
      cards: [createManifest().cards[0], createManifest().cards[0]],
    }).success).toBe(false);
    expect(LocalLibraryArchiveManifestV1Schema.safeParse({
      ...createManifest(),
      assetCount: 0,
    }).success).toBe(false);
    expect(LocalLibraryArchiveManifestV1Schema.safeParse({
      ...createManifest(),
      assets: [{ ...createManifest().assets[0], checksum: `sha256:${'d'.repeat(64)}` }],
    }).success).toBe(false);
    expect(LocalLibraryArchiveManifestV1Schema.safeParse({
      ...createManifest(),
      assets: [{ ...createManifest().assets[0], path: `assets/${'c'.repeat(64)}.PNG` }],
    }).success).toBe(false);
  });

  it('has no fields for Provider secrets or project authentication material', () => {
    expect(LocalLibraryArchiveManifestV1Schema.safeParse({
      ...createManifest(),
      apiKey: 'secret',
    }).success).toBe(false);
    expect(LocalLibraryArchiveManifestV1Schema.safeParse({
      ...createManifest(),
      authkey: 'legacy-secret',
    }).success).toBe(false);
  });
});
