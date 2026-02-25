import { type NextRequest } from 'next/server';

import { config as appConfig } from '@/lib/config';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  listCharacterLossesRanks,
  listCharacterParticipationRanks,
  listCharacterWinRateRanks,
  listCharacterWinsRanks,
  getTotalBattleCount,
  getTotalCharacterParticipations,
  type StatsLeaderboardMode,
} from '@/lib/db/repositories/arena-read';

export const config = {
  runtime: 'edge',
};

export interface StatsData {
  totalBattles: number;
  totalParticipants: number;
  winRateRank: CharacterRank[];
  participationRank: CharacterRank[];
  winsRank: CharacterRank[];
  lossesRank: CharacterRank[];
}

export interface CharacterRank {
  name: string;
  is_preset: boolean;
  value: number | string;
}

const normalizeLeaderboardMode = (value: unknown): StatsLeaderboardMode => {
  if (value === 'preset') return 'preset';
  if (value === 'user') return 'user';
  return 'all';
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = getDrizzleDbFromRuntime();
    if (!db) {
      return new Response(JSON.stringify({ error: '数据库绑定不可用，请检查 Cloudflare D1 配置' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const leaderboardMode = normalizeLeaderboardMode(appConfig.LEADERBOARD_MODE);
    const limit = 5;

    const [totalBattles, totalParticipants, winRateRankRows, participationRows, winsRows, lossesRows] =
      await Promise.all([
        getTotalBattleCount(db),
        getTotalCharacterParticipations(db),
        listCharacterWinRateRanks(db, leaderboardMode, limit),
        listCharacterParticipationRanks(db, leaderboardMode, limit),
        listCharacterWinsRanks(db, leaderboardMode, limit),
        listCharacterLossesRanks(db, leaderboardMode, limit),
      ]);

    const responseData: StatsData & { needsInitialization?: boolean } = {
      totalBattles,
      totalParticipants,
      winRateRank: winRateRankRows.map((row) => ({
        name: row.name,
        is_preset: row.isPreset,
        value: row.participations > 0 ? `${((row.wins / row.participations) * 100).toFixed(1)}% (${row.wins}胜)` : '0.0% (0胜)',
      })),
      participationRank: participationRows.map((row) => ({
        name: row.name,
        is_preset: row.isPreset,
        value: `${row.count}次`,
      })),
      winsRank: winsRows.map((row) => ({
        name: row.name,
        is_preset: row.isPreset,
        value: `${row.count}胜`,
      })),
      lossesRank: lossesRows.map((row) => ({
        name: row.name,
        is_preset: row.isPreset,
        value: `${row.count}败`,
      })),
    };

    const hasAnyData = totalBattles > 0
      || totalParticipants > 0
      || winRateRankRows.length > 0
      || participationRows.length > 0
      || winsRows.length > 0
      || lossesRows.length > 0;

    if (!hasAnyData) {
      responseData.needsInitialization = true;
    }

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('获取统计数据失败:', error);
    return new Response(JSON.stringify({ error: '无法加载统计数据' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
