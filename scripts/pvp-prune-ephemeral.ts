import { queryFromD1 } from '@/lib/database/core';
import { clearPvpRoomEphemeralState } from '@/lib/database/pvp';
import { clearPvpRoomRuntimeFromRulesJson } from '@/lib/pvp/bot/room';

type RoomRow = { id: string; status: string; phase: string; rules_json: string; expires_at: string | null; last_activity_at: string | null; updated_at: string | null };

const readRows = (result: any): RoomRow[] => {
  const rows = result?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as RoomRow[]) : [];
};

const main = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Math.max(1, Math.min(5000, Number(limitArg.split('=')[1] || 0))) : 500;

  const nowIso = new Date().toISOString();
  const result = await queryFromD1(
    `SELECT id, status, phase, rules_json, expires_at, last_activity_at, updated_at
     FROM pvp_rooms
     WHERE
       status = 'closed'
       OR phase IN ('finished', 'closed', 'aborted')
       OR (expires_at IS NOT NULL AND expires_at < ?)
     ORDER BY COALESCE(last_activity_at, updated_at) ASC
     LIMIT ?`,
    [nowIso, limit]
  );
  const rooms = readRows(result);

  console.log(`候选房间数：${rooms.length}（limit=${limit}）`);
  if (rooms.length <= 0) return;

  const sample = rooms.slice(0, 10).map((r) => ({ id: r.id, status: r.status, phase: r.phase, expiresAt: r.expires_at, lastActivityAt: r.last_activity_at }));
  console.log('示例（前 10 条）：', sample);

  if (dryRun) {
    console.log('dry-run 模式：不执行删除。');
    return;
  }

  let cleaned = 0;
  let runtimeCompacted = 0;

  for (const room of rooms) {
    const compact = clearPvpRoomRuntimeFromRulesJson(room.rules_json);
    if (compact !== room.rules_json) {
      await queryFromD1(
        'UPDATE pvp_rooms SET rules_json = ?, updated_at = ? WHERE id = ?',
        [compact, new Date().toISOString(), room.id]
      );
      runtimeCompacted += 1;
    }

    const ok = await clearPvpRoomEphemeralState(room.id);
    if (ok) cleaned += 1;
  }

  console.log(`✅ 已清理房间临时数据：${cleaned}/${rooms.length}`);
  console.log(`✅ 已压缩 rules_json（剥离运行时字段）：${runtimeCompacted}/${rooms.length}`);
};

main().catch((error) => {
  console.error('❌ PVP 临时数据清理失败:', error);
  process.exitCode = 1;
});

