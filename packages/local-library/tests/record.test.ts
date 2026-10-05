import {
  LocalCardProvenanceSchema,
  LocalCardRecordV1Schema,
  nextLocalTimestamp,
} from '@mahoshojo/local-library/record';

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

describe('LocalCardProvenance', () => {
  it.each([
    { kind: 'official-signed', execution: 'downloaded' },
    { kind: 'signature-invalid', execution: 'edited' },
    { kind: 'signature-unverified', execution: 'hosted' },
  ])('rejects signed provenance without signature: $kind', (provenance) => {
    expect(LocalCardProvenanceSchema.safeParse(provenance).success).toBe(false);
  });

  it.each([
    ['signature', { kind: 'unsigned', signature: 'signed-payload' }],
    ['signatureVersion', { kind: 'unsigned', signatureVersion: 1 }],
    ['signatureKeyId', { kind: 'unsigned', signatureKeyId: 'signing-key-2026' }],
  ])('rejects %s on unsigned provenance', (_evidenceField, provenance) => {
    expect(LocalCardProvenanceSchema.safeParse(provenance).success).toBe(false);
  });

  it.each([
    {
      kind: 'official-signed',
      signature: 'legacy-signed-payload',
      execution: 'downloaded',
    },
    {
      kind: 'signature-invalid',
      signature: 'legacy-invalid-signature',
      execution: 'edited',
    },
    {
      kind: 'signature-unverified',
      signature: 'draft-restored-signature',
      execution: 'hosted',
    },
  ])('accepts legacy signature evidence without version or key ID: $kind', (provenance) => {
    expect(LocalCardProvenanceSchema.safeParse(provenance).success).toBe(true);
  });
});

describe('nextLocalTimestamp', () => {
  it('没有既有时间戳时直接取当前时刻', () => {
    expect(nextLocalTimestamp(undefined, () => Date.parse('2026-09-30T12:00:00.000Z')))
      .toBe('2026-09-30T12:00:00.000Z');
  });

  it('当前时刻更晚时原样使用', () => {
    expect(nextLocalTimestamp('2026-09-30T12:00:00.000Z', () => Date.parse('2026-09-30T13:00:00.000Z')))
      .toBe('2026-09-30T13:00:00.000Z');
  });

  it('时钟回拨时抬到既有时间戳，而不是写出更早的时间', () => {
    // 抬到"相等"而不是"更晚"：声称一个比现在更晚的时刻是编造数据，而相等既满足
    // createdAt <= updatedAt <= deletedAt，也保证 keyset 排序不会倒退。
    expect(nextLocalTimestamp('2026-09-30T12:00:00.000Z', () => Date.parse('2026-09-30T11:00:00.000Z')))
      .toBe('2026-09-30T12:00:00.000Z');
  });

  it('既有时间戳无法解析时不抬升，把"数据已损坏"留给下游暴露', () => {
    expect(nextLocalTimestamp('not-a-timestamp', () => Date.parse('2026-09-30T12:00:00.000Z')))
      .toBe('2026-09-30T12:00:00.000Z');
  });

  it('抬升后的时间戳仍是合法的 ISO 8601，可直接作为记录字段', () => {
    const raised = nextLocalTimestamp('2026-09-30T12:00:00.000Z', () => Date.parse('2020-01-01T00:00:00.000Z'));
    const record = createLocalCardRecord({ updatedAt: raised });
    expect(LocalCardRecordV1Schema.safeParse(record).success).toBe(true);
  });
});
