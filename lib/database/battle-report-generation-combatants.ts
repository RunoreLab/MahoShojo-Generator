import { queryFromD1 } from './core';

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

export async function createBattleReportGenerationCombatants(
  combatants: BattleReportGenerationCombatantInsert[]
): Promise<{ ok: boolean; errorMessage?: string }> {
  try {
    if (!combatants.length) return { ok: true };
    const nowIso = new Date().toISOString();

    const valuesSql = combatants.map(() => `(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .join(', ');

    const sql = `
      INSERT INTO battle_report_generation_combatants (
        generation_id,
        sort_index,
        name,
        type,
        template_id,
        is_native,
        is_preset,
        team_id,
        character_guidance,
        data_card_id,
        data_card_updated_at,
        size_chars,
        size_bytes,
        created_at
      ) VALUES ${valuesSql};
    `;

    const params: unknown[] = [];
    for (const c of combatants) {
      params.push(
        c.generationId,
        c.sortIndex,
        c.name,
        c.type ?? null,
        c.templateId ?? null,
        typeof c.isNative === 'boolean' ? (c.isNative ? 1 : 0) : null,
        typeof c.isPreset === 'boolean' ? (c.isPreset ? 1 : 0) : null,
        c.teamId ?? null,
        c.characterGuidance ?? null,
        c.dataCardId ?? null,
        c.dataCardUpdatedAt ?? null,
        c.sizeChars ?? null,
        c.sizeBytes ?? null,
        nowIso
      );
    }

    const result = (await queryFromD1(sql, params)) as any;
    return { ok: Boolean(result?.success) };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown error';
    console.error('写入 battle_report_generation_combatants 失败:', { errorMessage, error });
    return { ok: false, errorMessage };
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
    const result = (await queryFromD1(
      'SELECT * FROM battle_report_generation_combatants WHERE generation_id = ? ORDER BY sort_index ASC',
      [generationId]
    )) as any;
    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as BattleReportGenerationCombatantRow[];
    }
    return [];
  } catch (error) {
    console.error('读取 battle_report_generation_combatants 失败:', error);
    return [];
  }
}
