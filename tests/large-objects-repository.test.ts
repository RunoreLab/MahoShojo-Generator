import { describe, expect, test } from 'bun:test';
import { largeObjects } from '@/lib/db/schema';
import { upsertLargeObjectByKindAndOwnerRef } from '@/lib/db/repositories/large-objects';

describe('large-objects repository', () => {
  test('upsertLargeObjectByKindAndOwnerRef 使用单条 onConflictDoUpdate 保持原子语义', async () => {
    let capturedValues: Record<string, unknown> | null = null;
    let capturedConflictConfig: Record<string, unknown> | null = null;

    const fakeDb = {
      insert: (_table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          capturedValues = values;
          return {
            onConflictDoUpdate: async (config: Record<string, unknown>) => {
              capturedConflictConfig = config;
            },
          };
        },
      }),
    } as unknown as Parameters<typeof upsertLargeObjectByKindAndOwnerRef>[0];

    await upsertLargeObjectByKindAndOwnerRef(fakeDb, {
      id: 'obj_1',
      kind: 'battle_report',
      ownerRefId: 'br_123',
      ownerUserId: 7,
      r2Key: 'bucket/path.obj',
      bytes: 100,
      storedBytes: 120,
      sha256: 'abc123',
      contentType: 'application/json',
      contentEncoding: null,
      nowIso: '2026-02-27T00:00:00.000Z',
    });

    expect(capturedValues).toBeTruthy();
    expect(capturedValues?.kind).toBe('battle_report');
    expect(capturedValues?.ownerRefId).toBe('br_123');
    expect(capturedConflictConfig).toBeTruthy();
    expect((capturedConflictConfig?.target as unknown[]).length).toBe(2);
    expect((capturedConflictConfig?.target as unknown[])[0]).toBe(largeObjects.kind);
    expect((capturedConflictConfig?.target as unknown[])[1]).toBe(largeObjects.ownerRefId);
    expect(capturedConflictConfig?.set).toBeTruthy();
  });
});
