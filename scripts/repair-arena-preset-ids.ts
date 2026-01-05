import { loadEnvConfig } from '@next/env';

import { PRESET_LIST } from '@/lib/presets';

type QueryFromD1 = (sql: string, params?: unknown[]) => Promise<unknown>;

const readRows = <T>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const hasChanges = (result: unknown): boolean => {
  const changes = (result as any)?.result?.[0]?.meta?.changes;
  return typeof changes === 'number' && Number.isFinite(changes) && changes > 0;
};

const parseArgs = (argv: string[]) => {
  const args = new Set(argv);
  return {
    apply: args.has('--apply'),
  };
};

const main = async () => {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
  const { queryFromD1 } = (await import('../lib/d1')) as { queryFromD1: QueryFromD1 };

  const { apply } = parseArgs(process.argv.slice(2));

  const presetIds = PRESET_LIST.map((preset) => preset.filename);
  const presetNameToId = new Map(PRESET_LIST.map((preset) => [preset.name.trim(), preset.filename]));

  const placeholders = presetIds.map(() => '?').join(', ');
  const invalid = (await queryFromD1(
    `SELECT entity_id as entityId, queue, rating, games, wins, losses, draws, updated_at as updatedAt
     FROM arena_ratings
     WHERE entity_type = 'preset'
       AND entity_id NOT IN (${placeholders})
     ORDER BY queue ASC, games DESC, updated_at DESC`,
    presetIds
  )) as any;

  const rows = readRows<{
    entityId: string;
    queue: 'strict' | 'free';
    rating: number;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    updatedAt: string;
  }>(invalid);

  if (rows.length === 0) {
    console.log('[repair-arena-preset-ids] 未发现异常预设 ID。');
    return;
  }

  console.log(`[repair-arena-preset-ids] 发现异常预设 ID：${rows.length} 条（${apply ? '将执行修复' : '仅预览'}）`);

  const nowIso = new Date().toISOString();

  for (const row of rows) {
    const entityId = typeof row.entityId === 'string' ? row.entityId.trim() : '';
    if (!entityId) continue;

    const canonical = presetNameToId.get(entityId) ?? null;
    if (!canonical) {
      console.log(`- 跳过：无法从预设名解析 filename：queue=${row.queue} entityId=${JSON.stringify(entityId)}`);
      continue;
    }

    const exists = (await queryFromD1(
      `SELECT 1 as ok
       FROM arena_ratings
       WHERE entity_type = 'preset' AND entity_id = ? AND queue = ?
       LIMIT 1`,
      [canonical, row.queue]
    )) as any;
    const canonicalExists = readRows<{ ok: number }>(exists).length > 0;

    if (canonicalExists) {
      console.log(`- 删除别名：queue=${row.queue} ${JSON.stringify(entityId)} -> ${canonical}（canonical 已存在）`);
      if (apply) {
        const deleted = await queryFromD1(
          `DELETE FROM arena_ratings
           WHERE entity_type = 'preset' AND entity_id = ? AND queue = ?`,
          [entityId, row.queue]
        );
        if (!hasChanges(deleted)) {
          console.log(`  - 警告：删除未生效（可能已被并发修复）：queue=${row.queue} entityId=${JSON.stringify(entityId)}`);
        }
      }
      continue;
    }

    console.log(`- 迁移主键：queue=${row.queue} ${JSON.stringify(entityId)} -> ${canonical}`);
    if (apply) {
      const updated = await queryFromD1(
        `UPDATE arena_ratings
         SET entity_id = ?, updated_at = ?
         WHERE entity_type = 'preset' AND entity_id = ? AND queue = ?`,
        [canonical, nowIso, entityId, row.queue]
      );
      if (!hasChanges(updated)) {
        console.log(`  - 警告：更新未生效（可能已被并发修复）：queue=${row.queue} entityId=${JSON.stringify(entityId)}`);
      }
    }
  }

  console.log('[repair-arena-preset-ids] 完成。');
  if (!apply) {
    console.log('提示：添加 --apply 参数可执行修复（会写入 D1）。');
  }
};

main().catch((error) => {
  console.error('[repair-arena-preset-ids] 失败:', error);
  process.exitCode = 1;
});

