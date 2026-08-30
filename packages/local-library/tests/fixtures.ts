import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';

export const createLocalCardRecord = (
  overrides: Partial<LocalCardRecordV1> = {},
): LocalCardRecordV1 => ({
  id: 'local-card-1',
  schemaVersion: 1,
  storageLocation: 'local',
  cardType: 'character',
  title: '测试角色',
  data: { name: '焰', templateId: '通用角色' },
  contentDigest: `sha256:${'a'.repeat(64)}`,
  provenance: {
    kind: 'unsigned',
    execution: 'direct-local',
  },
  createdAt: '2026-08-23T12:00:00.000Z',
  updatedAt: '2026-08-23T12:00:00.000Z',
  ...overrides,
});
