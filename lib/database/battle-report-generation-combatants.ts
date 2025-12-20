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

    const valuesSql = combatants.map(() => `(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
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
