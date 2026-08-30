import { loadEnvConfig } from '@next/env';

import {
  deletePresetArenaRatingByQueue,
  hasPresetArenaRatingByQueue,
  listInvalidPresetArenaRatings,
  renamePresetArenaRatingByQueue,
} from '@/lib/database/arena-maintenance';
import { PRESET_LIST } from '@/lib/presets';

const parseArgs = (argv: string[]) => {
  const args = new Set(argv);
  return {
    apply: args.has('--apply'),
  };
};

const main = async () => {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

  const { apply } = parseArgs(process.argv.slice(2));

  const presetIds = PRESET_LIST.map((preset) => preset.filename);
  const presetNameToId = new Map(PRESET_LIST.map((preset) => [preset.name.trim(), preset.filename]));

  const rows = await listInvalidPresetArenaRatings(presetIds);

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

    const canonicalExists = await hasPresetArenaRatingByQueue({
      entityId: canonical,
      queue: row.queue,
    });

    if (canonicalExists) {
      console.log(`- 删除别名：queue=${row.queue} ${JSON.stringify(entityId)} -> ${canonical}（canonical 已存在）`);
      if (apply) {
        const deleted = await deletePresetArenaRatingByQueue({
          entityId,
          queue: row.queue,
        });
        if (deleted <= 0) {
          console.log(`  - 警告：删除未生效（可能已被并发修复）：queue=${row.queue} entityId=${JSON.stringify(entityId)}`);
        }
      }
      continue;
    }

    console.log(`- 迁移主键：queue=${row.queue} ${JSON.stringify(entityId)} -> ${canonical}`);
    if (apply) {
      const updated = await renamePresetArenaRatingByQueue({
        fromEntityId: entityId,
        toEntityId: canonical,
        queue: row.queue,
        updatedAt: nowIso,
      });
      if (updated <= 0) {
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

