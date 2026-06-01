import { describe, expect, it } from 'vitest';

import {
  ADMIN_PVP_STALLED_ROOM_MINUTES,
  buildAdminPvpMatchWhereClause,
  buildAdminPvpRoomWhereClause,
} from '@/lib/database/admin-pvp';

describe('admin pvp filters', () => {
  it('支持房间检索组合筛选', () => {
    const built = buildAdminPvpRoomWhereClause({
      search: '1024',
      status: 'open',
      phase: 'resolving',
      stalledOnly: true,
    });

    expect(built.whereSql).toContain('r.id LIKE ?');
    expect(built.whereSql).toContain("CAST(r.host_user_id AS TEXT) = ?");
    expect(built.whereSql).toContain('r.status = ?');
    expect(built.whereSql).toContain('r.phase = ?');
    expect(built.whereSql).toContain(`datetime('now', '-${ADMIN_PVP_STALLED_ROOM_MINUTES} minutes')`);
    expect(built.params).toEqual(['%1024%', '%1024%', '%1024%', '1024', 'open', 'resolving']);
  });

  it('支持对局检索组合筛选', () => {
    const built = buildAdminPvpMatchWhereClause({
      search: '66',
      status: 'active',
      roomId: 'room-1',
      userId: 7,
    });

    expect(built.whereSql).toContain('m.id LIKE ?');
    expect(built.whereSql).toContain('CAST(mp.user_id AS TEXT) = ?');
    expect(built.whereSql).toContain('m.status = ?');
    expect(built.whereSql).toContain('m.room_id = ?');
    expect(built.whereSql).toContain('mp2.user_id = ?');
    expect(built.params).toEqual(['%66%', '%66%', '%66%', '%66%', '66', 'active', 'room-1', 7]);
  });
});
