export interface BattleReportGenerationCombatantInsert {
  generationId: string;
  sortIndex: number;
  name: string;
  type?: string | null;
  templateId?: string | null;
  isNative?: boolean | null;
  isPreset?: boolean | null;
  teamId?: number | null;
  characterGuidance?: string | null;
  dataCardId?: string | null;
  dataCardUpdatedAt?: string | null;
  sizeChars?: number | null;
  sizeBytes?: number | null;
}

type CombatantsRepoBundle = {
  db: unknown;
  insertBattleReportGenerationCombatants: (
    db: unknown,
    combatants: BattleReportGenerationCombatantInsert[],
    createdAtIso: string,
  ) => Promise<boolean>;
  listBattleReportGenerationCombatantsByGenerationId: (
    db: unknown,
    generationId: string,
  ) => Promise<BattleReportGenerationCombatantRow[]>;
};

const COMBATANTS_WRITE_ERROR = 'combatants-write-failed';
const COMBATANTS_READ_ERROR = 'combatants-read-failed';

const readCombatantsRepoBundle = async (): Promise<CombatantsRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/battle-report-generation-combatants'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      insertBattleReportGenerationCombatants: repo.insertBattleReportGenerationCombatants as CombatantsRepoBundle['insertBattleReportGenerationCombatants'],
      listBattleReportGenerationCombatantsByGenerationId: repo.listBattleReportGenerationCombatantsByGenerationId as CombatantsRepoBundle['listBattleReportGenerationCombatantsByGenerationId'],
    };
  } catch {
    return null;
  }
};

export async function createBattleReportGenerationCombatants(
  combatants: BattleReportGenerationCombatantInsert[]
): Promise<{ ok: boolean; errorMessage?: string }> {
  try {
    if (!combatants.length) return { ok: true };
    const bundle = await readCombatantsRepoBundle();
    if (!bundle) return { ok: false, errorMessage: 'db-unavailable' };
    const ok = await bundle.insertBattleReportGenerationCombatants(
      bundle.db,
      combatants,
      new Date().toISOString(),
    );
    return { ok };
  } catch {
    console.error('写入 battle_report_generation_combatants 失败:', {
      errorClass: COMBATANTS_WRITE_ERROR,
    });
    return { ok: false, errorMessage: COMBATANTS_WRITE_ERROR };
  }
}

export interface BattleReportGenerationCombatantRow {
  generation_id: string;
  sort_index: number;
  name: string;
  type: string | null;
  template_id: string | null;
  is_native: number | null;
  is_preset: number | null;
  team_id: number | null;
  character_guidance: string | null;
  data_card_id: string | null;
  data_card_updated_at: string | null;
  size_chars: number | null;
  size_bytes: number | null;
  created_at: string;
}

export async function getBattleReportGenerationCombatantsByGenerationId(
  generationId: string
): Promise<BattleReportGenerationCombatantRow[]> {
  try {
    const bundle = await readCombatantsRepoBundle();
    if (!bundle) return [];
    return await bundle.listBattleReportGenerationCombatantsByGenerationId(bundle.db, generationId);
  } catch {
    console.error('读取 battle_report_generation_combatants 失败:', {
      errorClass: COMBATANTS_READ_ERROR,
    });
    return [];
  }
}
