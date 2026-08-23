import { LocalCardRecordV1Schema } from '@mahoshojo/local-library/record';

import { createLocalCardRecord } from './fixtures';

describe('LocalCardRecordV1', () => {
  it('accepts a versioned local record with provenance and an optional cloud copy reference', () => {
    const record = createLocalCardRecord({
      provenance: {
        kind: 'official-signed',
        signature: 'signed-payload',
        signatureVersion: 1,
        signatureKeyId: 'signing-key-2026',
        execution: 'downloaded',
      },
      cloudRef: {
        cardId: 'cloud-card-1',
        cloudRevision: 'revision-3',
        copiedAt: '2026-08-23T12:30:00.000Z',
      },
    });

    expect(LocalCardRecordV1Schema.parse(record)).toEqual(record);
    expect(LocalCardRecordV1Schema.safeParse(createLocalCardRecord({
      contentDigest: 'future-digest:abcdefghijklmnop',
    })).success).toBe(true);
  });

  it('rejects cloud storage, malformed digests, non-JSON payloads, and unknown fields', () => {
    expect(LocalCardRecordV1Schema.safeParse({
      ...createLocalCardRecord(),
      storageLocation: 'cloud',
    }).success).toBe(false);
    expect(LocalCardRecordV1Schema.safeParse({
      ...createLocalCardRecord(),
      contentDigest: 'missing-algorithm-prefix',
    }).success).toBe(false);
    expect(LocalCardRecordV1Schema.safeParse({
      ...createLocalCardRecord(),
      data: { createdAt: new Date() },
    }).success).toBe(false);
    expect(LocalCardRecordV1Schema.safeParse({
      ...createLocalCardRecord(),
      slotCount: 1,
    }).success).toBe(false);
  });

  it('returns a defensive copy of the JSON payload after validation', () => {
    const input = createLocalCardRecord({ data: { nested: { value: 'original' } } });
    const parsed = LocalCardRecordV1Schema.parse(input);

    (input.data as { nested: { value: string } }).nested.value = 'mutated';

    expect(parsed.data).toEqual({ nested: { value: 'original' } });
  });

  it('keeps deletion as an explicit timestamp and enforces timestamp order', () => {
    expect(LocalCardRecordV1Schema.parse(createLocalCardRecord({
      deletedAt: '2026-08-23T13:00:00.000Z',
    })).deletedAt).toBe('2026-08-23T13:00:00.000Z');

    expect(LocalCardRecordV1Schema.safeParse(createLocalCardRecord({
      updatedAt: '2026-08-23T11:59:59.000Z',
    })).success).toBe(false);
    expect(LocalCardRecordV1Schema.safeParse(createLocalCardRecord({
      deletedAt: '2026-08-23T11:59:59.000Z',
    })).success).toBe(false);
    expect(LocalCardRecordV1Schema.safeParse(createLocalCardRecord({
      updatedAt: '2026-08-23T14:00:00.000Z',
      deletedAt: '2026-08-23T13:00:00.000Z',
    })).success).toBe(false);
  });
});
