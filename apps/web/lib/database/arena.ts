type ArenaRepoBundle = {
  db: unknown;
  getCharacterByName: (db: unknown, name: string) => Promise<any>;
  ensureCharacterExists: (db: unknown, name: string, isPreset: boolean) => Promise<void>;
  incrementCharacterStats: (
    db: unknown,
    name: string,
    options: { won: boolean; countedAsLoss: boolean },
  ) => Promise<boolean>;
  createBattleRecord: (
    db: unknown,
    winnerName: string,
    participantsJson: string,
    createdAtIso: string,
  ) => Promise<number | null>;
  listCharacterLeaderboardRows: (db: unknown, limit?: number) => Promise<any[]>;
  listRecentBattleRows: (db: unknown, limit?: number) => Promise<any[]>;
};

const readArenaRepoBundle = async (): Promise<ArenaRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/arena-legacy-stats'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      getCharacterByName: repo.getCharacterByName as ArenaRepoBundle['getCharacterByName'],
      ensureCharacterExists: repo.ensureCharacterExists as ArenaRepoBundle['ensureCharacterExists'],
      incrementCharacterStats: repo.incrementCharacterStats as ArenaRepoBundle['incrementCharacterStats'],
      createBattleRecord: repo.createBattleRecord as ArenaRepoBundle['createBattleRecord'],
      listCharacterLeaderboardRows: repo.listCharacterLeaderboardRows as ArenaRepoBundle['listCharacterLeaderboardRows'],
      listRecentBattleRows: repo.listRecentBattleRows as ArenaRepoBundle['listRecentBattleRows'],
    };
  } catch {
    return null;
  }
};

// 角色战斗统计相关函数

// 获取或创建角色
export async function getOrCreateCharacter(name: string, isPreset: boolean = false): Promise<any> {
  try {
    const bundle = await readArenaRepoBundle();
    if (!bundle) return null;

    const existing = await bundle.getCharacterByName(bundle.db, name);
    if (existing) return existing;

    await bundle.ensureCharacterExists(bundle.db, name, isPreset);
    return {
      name,
      is_preset: isPreset ? 1 : 0,
      wins: 0,
      losses: 0,
      participations: 0,
    };
  } catch (error) {
    console.error('获取或创建角色失败:', error);
    return null;
  }
}

// 更新角色战斗统计
export async function updateCharacterStats(
  name: string,
  won: boolean,
  participated: boolean = true,
): Promise<boolean> {
  try {
    const bundle = await readArenaRepoBundle();
    if (!bundle) return false;

    return await bundle.incrementCharacterStats(bundle.db, name, {
      won,
      countedAsLoss: !won && participated,
    });
  } catch (error) {
    console.error('更新角色统计失败:', error);
    return false;
  }
}

// 记录战斗结果
export async function recordBattle(
  winnerName: string,
  participants: string[],
): Promise<number | null> {
  try {
    const timestamp = new Date().toISOString();
    const participantsJson = JSON.stringify(participants);

    const bundle = await readArenaRepoBundle();
    if (!bundle) return null;

    return await bundle.createBattleRecord(bundle.db, winnerName, participantsJson, timestamp);
  } catch (error) {
    console.error('记录战斗失败:', error);
    return null;
  }
}

// 获取角色排行榜
export async function getCharacterLeaderboard(limit: number = 10): Promise<any[]> {
  try {
    const bundle = await readArenaRepoBundle();
    if (!bundle) return [];
    return await bundle.listCharacterLeaderboardRows(bundle.db, limit);
  } catch (error) {
    console.error('获取排行榜失败:', error);
    return [];
  }
}

// 获取最近的战斗记录
export async function getRecentBattles(limit: number = 20): Promise<any[]> {
  try {
    const bundle = await readArenaRepoBundle();
    if (!bundle) return [];
    return await bundle.listRecentBattleRows(bundle.db, limit);
  } catch (error) {
    console.error('获取战斗记录失败:', error);
    return [];
  }
}
