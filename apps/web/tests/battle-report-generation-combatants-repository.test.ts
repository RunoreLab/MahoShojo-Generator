import { describe, expect, test } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { insertBattleReportGenerationCombatants } from '@/lib/db/repositories/battle-report-generation-combatants';
import * as schema from '@/lib/db/schema';

type CapturedStatement = {
  sql: string;
  params: unknown[];
};

const createRecordingDb = (): {
  batchCalls: CapturedStatement[][];
  db: AppDrizzleDb;
} => {
  const batchCalls: CapturedStatement[][] = [];
  const client = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            params,
            sql,
            async run() {
              return {
                meta: { changes: 1, rows_written: 1 },
                results: [],
                success: true,
              };
            },
          };
        },
      };
    },
    async batch(statements: CapturedStatement[]) {
      batchCalls.push(statements.map((statement) => ({
        params: [...statement.params],
        sql: statement.sql,
      })));
      return statements.map(() => ({
        meta: { changes: 1, rows_written: 1 },
        results: [],
        success: true,
      }));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  };

  return {
    batchCalls,
    db: drizzle(client as never, { schema }) as AppDrizzleDb,
  };
};

describe('insertBattleReportGenerationCombatants', () => {
  test('32 位角色会在一次原子 batch 中拆成不超过 D1 绑定参数上限的语句', async () => {
    const { batchCalls, db } = createRecordingDb();

    await insertBattleReportGenerationCombatants(
      db,
      Array.from({ length: 32 }, (_, sortIndex) => ({
        generationId: 'generation-1',
        sortIndex,
        name: `角色-${sortIndex}`,
      })),
      '2026-08-27T00:00:00.000Z',
    );

    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]?.map((statement) => statement.params.length)).toEqual([
      98,
      98,
      98,
      98,
      56,
    ]);
  });
});
