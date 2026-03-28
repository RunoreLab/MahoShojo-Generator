import { describe, expect, mock, test } from 'bun:test';
import * as actualR2 from '@/lib/r2';

const toD1Result = (rows: Array<Record<string, unknown>>) => ({
  result: [{ results: rows }],
});

const state = {
  kindRows: [] as Array<Record<string, unknown>>,
  indexedRows: [] as Array<Record<string, unknown>>,
  missingIndexGenerationRows: [] as Array<Record<string, unknown>>,
  r2Result: {
    success: true,
    data: {
      objects: [] as Array<{ key: string; size: number; lastModified?: string }>,
      truncated: false,
      pages: 1,
    },
  } as
    | {
        success: true;
        data: {
          objects: Array<{ key: string; size: number; lastModified?: string }>;
          truncated: boolean;
          pages: number;
        };
      }
    | { success: false; error: string },
};

mock.module('@/lib/database/core', () => ({
  queryFromD1: async (sql: string) => {
    if (sql.includes('FROM large_objects') && sql.includes('GROUP BY kind')) {
      return toD1Result(state.kindRows);
    }
    if (sql.includes('FROM large_objects lo') && sql.includes('LEFT JOIN battle_report_generations brg')) {
      return toD1Result(state.indexedRows);
    }
    if (sql.includes('WHERE brg.id IN')) {
      return toD1Result(state.missingIndexGenerationRows);
    }
    throw new Error(`未匹配的 SQL: ${sql}`);
  },
}));

mock.module('@/lib/r2', () => ({
  ...actualR2,
  listAllObjects: async () => state.r2Result,
}));

describe('admin large objects consistency report', () => {
  test('mock 仅覆盖 listAllObjects，不应丢失其他 R2 导出', async () => {
    const r2 = await import('@/lib/r2');

    expect(typeof r2.listAllObjects).toBe('function');
    expect(typeof r2.getObjectText).toBe('function');
    expect(typeof r2.deleteObject).toBe('function');
  });

  test('同时识别 orphan / dangling / missing-index，并标记未接入 kind', async () => {
    state.kindRows = [{ kind: 'battle_report_generation_output' }, { kind: 'portrait' }];
    state.indexedRows = [
      {
        id: 'lo-1',
        kind: 'battle_report_generation_output',
        owner_ref_id: 'gen-1',
        owner_user_id: 11,
        owner_username: 'Alice',
        r2_key: 'v1/battle-report-generations/2026/03/01/gen-1/output.json',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:10:00.000Z',
        generation_id: 'gen-1',
        generation_status: 'completed',
        generation_started_at: '2026-03-01T00:00:00.000Z',
        has_output_preview: 1,
      },
      {
        id: 'lo-2',
        kind: 'battle_report_generation_output',
        owner_ref_id: 'gen-2',
        owner_user_id: 12,
        owner_username: 'Bob',
        r2_key: 'v1/battle-report-generations/2026/03/02/gen-2/output.json',
        created_at: '2026-03-02T00:00:00.000Z',
        updated_at: '2026-03-02T00:10:00.000Z',
        generation_id: null,
        generation_status: null,
        generation_started_at: null,
        has_output_preview: 0,
      },
      {
        id: 'lo-3',
        kind: 'battle_report_generation_output',
        owner_ref_id: 'gen-3',
        owner_user_id: 13,
        owner_username: 'Carol',
        r2_key: 'v1/battle-report-generations/2026/03/03/gen-3/output.md',
        created_at: '2026-03-03T00:00:00.000Z',
        updated_at: '2026-03-03T00:10:00.000Z',
        generation_id: 'gen-3',
        generation_status: 'completed',
        generation_started_at: '2026-03-03T00:00:00.000Z',
        has_output_preview: 0,
      },
    ];
    state.missingIndexGenerationRows = [
      {
        generation_id: 'gen-4',
        generation_status: 'completed',
        started_at: '2026-03-04T00:00:00.000Z',
        owner_user_id: 14,
        owner_username: 'Diana',
      },
    ];
    state.r2Result = {
      success: true,
      data: {
        objects: [
          {
            key: 'v1/battle-report-generations/2026/03/01/gen-1/output.json',
            size: 100,
            lastModified: '2026-03-01T00:05:00.000Z',
          },
          {
            key: 'v1/battle-report-generations/2026/03/04/gen-4/output.md',
            size: 120,
            lastModified: '2026-03-04T00:05:00.000Z',
          },
        ],
        truncated: false,
        pages: 1,
      },
    };

    const { getAdminLargeObjectConsistencyReport } = await import('@/lib/database/admin-large-objects');
    const report = await getAdminLargeObjectConsistencyReport();

    expect(report.inspectedKinds).toEqual(['battle_report_generation_output']);
    expect(report.skippedKinds).toEqual(['portrait']);
    expect(report.indexedRowsInspected).toBe(3);
    expect(report.r2ObjectsInspected).toBe(2);
    expect(report.truncatedR2Scan).toBe(false);
    expect(report.orphan.count).toBe(1);
    expect(report.orphan.samples[0]).toMatchObject({
      rowId: 'lo-2',
      ownerRefId: 'gen-2',
    });
    expect(report.dangling.count).toBe(1);
    expect(report.dangling.samples[0]).toMatchObject({
      rowId: 'lo-3',
      ownerRefId: 'gen-3',
    });
    expect(report.missingIndex.count).toBe(1);
    expect(report.missingIndex.samples[0]).toMatchObject({
      rowId: null,
      ownerRefId: 'gen-4',
      ownerUsername: 'Diana',
    });
    expect(report.missingIndex.samples[0].adminHref).toContain('gen-4');
    expect(report.notes.some((note) => note.includes('portrait'))).toBe(true);
  });

  test('R2 不可用时仅返回 orphan，其他两项标记为 unavailable', async () => {
    state.kindRows = [{ kind: 'battle_report_generation_output' }];
    state.indexedRows = [
      {
        id: 'lo-9',
        kind: 'battle_report_generation_output',
        owner_ref_id: 'gen-9',
        owner_user_id: 19,
        owner_username: 'Echo',
        r2_key: 'v1/battle-report-generations/2026/03/09/gen-9/output.json',
        created_at: '2026-03-09T00:00:00.000Z',
        updated_at: '2026-03-09T00:10:00.000Z',
        generation_id: null,
        generation_status: null,
        generation_started_at: null,
        has_output_preview: 0,
      },
    ];
    state.missingIndexGenerationRows = [];
    state.r2Result = {
      success: false,
      error: 'R2 unavailable',
    };

    const { getAdminLargeObjectConsistencyReport } = await import('@/lib/database/admin-large-objects');
    const report = await getAdminLargeObjectConsistencyReport();

    expect(report.orphan.available).toBe(true);
    expect(report.orphan.count).toBe(1);
    expect(report.dangling.available).toBe(false);
    expect(report.missingIndex.available).toBe(false);
    expect(report.dangling.count).toBe(0);
    expect(report.missingIndex.count).toBe(0);
    expect(report.notes.some((note) => note.includes('R2 前缀扫描失败'))).toBe(true);
  });
});
