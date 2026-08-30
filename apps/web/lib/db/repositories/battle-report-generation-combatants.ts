import { eq } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { battleReportGenerationCombatants } from '@/lib/db/schema';

export type BattleReportGenerationCombatantInsert = {
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
};

export type BattleReportGenerationCombatantDbRow = {
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
};

const D1_MAX_BOUND_PARAMETERS = 100;
const COMBATANT_BOUND_PARAMETERS_PER_ROW = 14;
const COMBATANT_INSERT_ROWS_PER_STATEMENT = Math.floor(
  D1_MAX_BOUND_PARAMETERS / COMBATANT_BOUND_PARAMETERS_PER_ROW,
);

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toIntOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};

export const insertBattleReportGenerationCombatants = async (
  db: AppDrizzleDb,
  combatants: BattleReportGenerationCombatantInsert[],
  createdAtIso: string,
): Promise<boolean> => {
  if (combatants.length === 0) return true;

  const rows = combatants.map((item) => ({
    generationId: item.generationId,
    sortIndex: item.sortIndex,
    name: item.name,
    type: item.type ?? null,
    templateId: item.templateId ?? null,
    isNative: typeof item.isNative === 'boolean' ? (item.isNative ? 1 : 0) : null,
    isPreset: typeof item.isPreset === 'boolean' ? (item.isPreset ? 1 : 0) : null,
    teamId: item.teamId ?? null,
    characterGuidance: item.characterGuidance ?? null,
    dataCardId: item.dataCardId ?? null,
    dataCardUpdatedAt: item.dataCardUpdatedAt ?? null,
    sizeChars: item.sizeChars ?? null,
    sizeBytes: item.sizeBytes ?? null,
    createdAt: createdAtIso,
  }));
  const inserts = [];
  for (let start = 0; start < rows.length; start += COMBATANT_INSERT_ROWS_PER_STATEMENT) {
    inserts.push(
      db
        .insert(battleReportGenerationCombatants)
        .values(rows.slice(start, start + COMBATANT_INSERT_ROWS_PER_STATEMENT)),
    );
  }
  const [first, ...remaining] = inserts;
  if (!first) return true;
  await db.batch([first, ...remaining]);

  return true;
};

export const listBattleReportGenerationCombatantsByGenerationId = async (
  db: AppDrizzleDb,
  generationId: string,
): Promise<BattleReportGenerationCombatantDbRow[]> => {
  const rows = await db
    .select({
      generationId: battleReportGenerationCombatants.generationId,
      sortIndex: battleReportGenerationCombatants.sortIndex,
      name: battleReportGenerationCombatants.name,
      type: battleReportGenerationCombatants.type,
      templateId: battleReportGenerationCombatants.templateId,
      isNative: battleReportGenerationCombatants.isNative,
      isPreset: battleReportGenerationCombatants.isPreset,
      teamId: battleReportGenerationCombatants.teamId,
      characterGuidance: battleReportGenerationCombatants.characterGuidance,
      dataCardId: battleReportGenerationCombatants.dataCardId,
      dataCardUpdatedAt: battleReportGenerationCombatants.dataCardUpdatedAt,
      sizeChars: battleReportGenerationCombatants.sizeChars,
      sizeBytes: battleReportGenerationCombatants.sizeBytes,
      createdAt: battleReportGenerationCombatants.createdAt,
    })
    .from(battleReportGenerationCombatants)
    .where(eq(battleReportGenerationCombatants.generationId, generationId))
    .orderBy(battleReportGenerationCombatants.sortIndex);

  return rows.map((row) => ({
    generation_id: row.generationId,
    sort_index: toInt(row.sortIndex, 0),
    name: row.name,
    type: typeof row.type === 'string' ? row.type : null,
    template_id: typeof row.templateId === 'string' ? row.templateId : null,
    is_native: toIntOrNull(row.isNative),
    is_preset: toIntOrNull(row.isPreset),
    team_id: toIntOrNull(row.teamId),
    character_guidance: typeof row.characterGuidance === 'string' ? row.characterGuidance : null,
    data_card_id: typeof row.dataCardId === 'string' ? row.dataCardId : null,
    data_card_updated_at: typeof row.dataCardUpdatedAt === 'string' ? row.dataCardUpdatedAt : null,
    size_chars: toIntOrNull(row.sizeChars),
    size_bytes: toIntOrNull(row.sizeBytes),
    created_at: row.createdAt,
  }));
};
