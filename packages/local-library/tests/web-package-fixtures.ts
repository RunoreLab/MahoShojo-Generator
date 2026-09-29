import type { WebPackageManifest } from '@mahoshojo/contracts/web-package';

import type { LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';

const DIGEST = `sha256:${'b'.repeat(64)}`;

export const createWebPackageManifest = (
  overrides: Partial<WebPackageManifest> = {},
): WebPackageManifest => ({
  format: 'mahoshojo-web-package',
  formatVersion: 1,
  id: 'local.library-test',
  version: '1.0.0',
  name: '本地库测试包',
  entry: 'index.html',
  generation: {
    target: 'index.html',
    mode: 'replace',
    mediaType: 'text/html',
  },
  capabilities: ['scripts'],
  files: [
    { path: 'index.html', mediaType: 'text/html', digest: DIGEST, size: 12 },
  ],
  ...overrides,
});

export const createLocalWebPackageRecord = (
  overrides: Partial<LocalWebPackageRecordV1> = {},
): LocalWebPackageRecordV1 => ({
  id: 'local-web-package-1',
  schemaVersion: 1,
  storageLocation: 'local',
  entityKind: 'web-package',
  title: '本地库测试包',
  summary: 'local.library-test@1.0.0',
  ref: { id: 'local.library-test', version: '1.0.0', digest: DIGEST },
  manifest: createWebPackageManifest(),
  contentDigest: DIGEST,
  archiveByteLength: 2048,
  provenance: { kind: 'unsigned', execution: 'imported' },
  createdAt: '2026-09-29T12:00:00.000Z',
  updatedAt: '2026-09-29T12:00:00.000Z',
  ...overrides,
});
