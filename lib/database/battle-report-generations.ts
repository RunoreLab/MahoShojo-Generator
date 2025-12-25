import { queryFromD1, generateUUID } from './core';

export type BattleReportGenerationStatus = 'completed' | 'aborted' | 'failed';
export type BattleReportGenerationMode = 'stream' | 'non-stream';
export type BattleReportGenerationListSort = 'started_at_desc' | 'started_at_asc';

export type BattleReportGenerationsListFilter = {
  status?: BattleReportGenerationStatus;
  mode?: string;
  generationMode?: BattleReportGenerationMode;
  pvpOnly?: boolean;
  titleQuery?: string;
  sort?: BattleReportGenerationListSort;
};

export interface BattleReportGenerationInsert {
  id?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: BattleReportGenerationStatus;
  generationMode: BattleReportGenerationMode;
  endpoint: string;

  ip?: string | null;
  ipAnonymized?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  acceptLanguage?: string | null;
  cfRay?: string | null;
  cfCountry?: string | null;

  userId?: number | null;
  username?: string | null;
  userPrefix?: string | null;

  mode: string;
  scenarioTitle?: string | null;
  scenarioDataCardId?: string | null;
  scenarioDataCardUpdatedAt?: string | null;
  language?: string | null;
  selectedLevel?: string | null;
  storyLength?: string | null;

  readArenaHistory?: boolean | null;
  arenaHistoryReadLimit?: number | null;
  writeArenaHistory?: boolean | null;
  readCurrentState?: boolean | null;
  writeCurrentState?: boolean | null;

  combatantCount?: number | null;
  hasScenario?: boolean | null;
  hasUserGuidance?: boolean | null;
  hasAdjudicationEvents?: boolean | null;
  hasTeams?: boolean | null;
  inputChars?: number | null;
  inputBytes?: number | null;

  userGuidancePreview?: string | null;
  adjudicationEventsPreview?: string | null;

  customProviderId?: string | null;
  customModelId?: string | null;
  isDowngrade?: boolean | null;
  aiProviderName?: string | null;
  aiProviderType?: string | null;
  aiModel?: string | null;

  headline?: string | null;
  winner?: string | null;

  outputChars?: number | null;
  outputBytes?: number | null;

  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  cachedTokens?: number | null;
  reasoningTokens?: number | null;

  outputPreview?: string | null;
  outputHasSensitiveWords?: boolean | null;
  outputHasShieldWords?: boolean | null;

  pvpRoomId?: string | null;
  pvpMatchId?: string | null;
  pvpRoundId?: string | null;

  extraJson?: Record<string, unknown> | null;
}

export async function createBattleReportGenerationRecord(
  payload: BattleReportGenerationInsert
): Promise<string | null> {
  try {
    const nowIso = new Date().toISOString();
    const id = payload.id ?? generateUUID();

    const sql = `
      INSERT INTO battle_report_generations (
        id,
        started_at,
        ended_at,
        duration_ms,
        status,
        generation_mode,
        endpoint,
        ip,
        ip_anonymized,
        user_agent,
        referer,
        accept_language,
        cf_ray,
        cf_country,
        user_id,
        username,
        user_prefix,
        mode,
        scenario_title,
        scenario_data_card_id,
        scenario_data_card_updated_at,
        language,
        selected_level,
        story_length,
        read_arena_history,
        arena_history_read_limit,
        write_arena_history,
        read_current_state,
        write_current_state,
        combatant_count,
        has_scenario,
        has_user_guidance,
        has_adjudication_events,
        has_teams,
        input_chars,
        input_bytes,
        user_guidance_preview,
        adjudication_events_preview,
        custom_provider_id,
        custom_model_id,
        is_downgrade,
        ai_provider_name,
        ai_provider_type,
        ai_model,
        headline,
        winner,
        output_chars,
        output_bytes,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        cached_tokens,
        reasoning_tokens,
        output_preview,
        output_has_sensitive_words,
        output_has_shield_words,
        pvp_room_id,
        pvp_match_id,
        pvp_round_id,
        extra_json,
        created_at,
        updated_at
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?
      );
    `;

    const params: unknown[] = [
      id,
      payload.startedAt,
      payload.endedAt,
      payload.durationMs,
      payload.status,
      payload.generationMode,
      payload.endpoint,
      payload.ip ?? null,
      payload.ipAnonymized ?? null,
      payload.userAgent ?? null,
      payload.referer ?? null,
      payload.acceptLanguage ?? null,
      payload.cfRay ?? null,
      payload.cfCountry ?? null,
      payload.userId ?? null,
      payload.username ?? null,
      payload.userPrefix ?? null,
      payload.mode,
      payload.scenarioTitle ?? null,
      payload.scenarioDataCardId ?? null,
      payload.scenarioDataCardUpdatedAt ?? null,
      payload.language ?? null,
      payload.selectedLevel ?? null,
      payload.storyLength ?? null,
      typeof payload.readArenaHistory === 'boolean' ? (payload.readArenaHistory ? 1 : 0) : null,
      payload.arenaHistoryReadLimit ?? null,
      typeof payload.writeArenaHistory === 'boolean' ? (payload.writeArenaHistory ? 1 : 0) : null,
      typeof payload.readCurrentState === 'boolean' ? (payload.readCurrentState ? 1 : 0) : null,
      typeof payload.writeCurrentState === 'boolean' ? (payload.writeCurrentState ? 1 : 0) : null,
      payload.combatantCount ?? null,
      typeof payload.hasScenario === 'boolean' ? (payload.hasScenario ? 1 : 0) : null,
      typeof payload.hasUserGuidance === 'boolean' ? (payload.hasUserGuidance ? 1 : 0) : null,
      typeof payload.hasAdjudicationEvents === 'boolean' ? (payload.hasAdjudicationEvents ? 1 : 0) : null,
      typeof payload.hasTeams === 'boolean' ? (payload.hasTeams ? 1 : 0) : null,
      payload.inputChars ?? null,
      payload.inputBytes ?? null,
      payload.userGuidancePreview ?? null,
      payload.adjudicationEventsPreview ?? null,
      payload.customProviderId ?? null,
      payload.customModelId ?? null,
      typeof payload.isDowngrade === 'boolean' ? (payload.isDowngrade ? 1 : 0) : null,
      payload.aiProviderName ?? null,
      payload.aiProviderType ?? null,
      payload.aiModel ?? null,
      payload.headline ?? null,
      payload.winner ?? null,
      payload.outputChars ?? null,
      payload.outputBytes ?? null,
      payload.promptTokens ?? null,
      payload.completionTokens ?? null,
      payload.totalTokens ?? null,
      payload.cachedTokens ?? null,
      payload.reasoningTokens ?? null,
      payload.outputPreview ?? null,
      typeof payload.outputHasSensitiveWords === 'boolean' ? (payload.outputHasSensitiveWords ? 1 : 0) : null,
      typeof payload.outputHasShieldWords === 'boolean' ? (payload.outputHasShieldWords ? 1 : 0) : null,
      payload.pvpRoomId ?? null,
      payload.pvpMatchId ?? null,
      payload.pvpRoundId ?? null,
      payload.extraJson ? JSON.stringify(payload.extraJson) : null,
      nowIso,
      nowIso,
    ];

    const result = (await queryFromD1(sql, params)) as any;
    if (result?.success) return id;
    return null;
  } catch (error) {
    console.error('写入 battle_report_generations 失败:', error);
    return null;
  }
}

export interface BattleReportGenerationRowLite {
  id: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: BattleReportGenerationStatus;
  generation_mode: BattleReportGenerationMode;
  endpoint: string;
  user_id: number | null;
  mode: string;
  scenario_title: string | null;
  scenario_data_card_id: string | null;
  scenario_data_card_updated_at: string | null;
  language: string | null;
  selected_level: string | null;
  story_length: string | null;
  headline: string | null;
  winner: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  output_preview: string | null;
  output_has_sensitive_words: number | null;
  output_has_shield_words: number | null;
  pvp_room_id: string | null;
  pvp_match_id: string | null;
  pvp_round_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function getBattleReportGenerationByIdLite(
  generationId: string
): Promise<BattleReportGenerationRowLite | null> {
  try {
    const result = (await queryFromD1(
      `SELECT
        id,
        started_at,
        ended_at,
        duration_ms,
        status,
        generation_mode,
        endpoint,
        user_id,
        mode,
        scenario_title,
        scenario_data_card_id,
        scenario_data_card_updated_at,
        language,
        selected_level,
        story_length,
        headline,
        winner,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        cached_tokens,
        reasoning_tokens,
        output_preview,
        output_has_sensitive_words,
        output_has_shield_words,
        pvp_room_id,
        pvp_match_id,
        pvp_round_id,
        created_at,
        updated_at
      FROM battle_report_generations
      WHERE id = ?`,
      [generationId]
    )) as any;

    if (result.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0] as BattleReportGenerationRowLite;
    }
    return null;
  } catch (error) {
    console.error('读取 battle_report_generations(id) 失败:', error);
    return null;
  }
}

export async function getBattleReportGenerationsByUserIdLite(
  userId: number,
  limit: number,
  offset = 0,
  filter?: BattleReportGenerationsListFilter
): Promise<BattleReportGenerationRowLite[]> {
  try {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    const { whereSql, params, orderBySql } = buildBattleReportGenerationsWhereClause(userId, filter);
    const result = (await queryFromD1(
      `SELECT
        id,
        started_at,
        ended_at,
        duration_ms,
        status,
        generation_mode,
        endpoint,
        user_id,
        mode,
        scenario_title,
        scenario_data_card_id,
        scenario_data_card_updated_at,
        language,
        selected_level,
        story_length,
        headline,
        winner,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        cached_tokens,
        reasoning_tokens,
        output_preview,
        output_has_sensitive_words,
        output_has_shield_words,
        pvp_room_id,
        pvp_match_id,
        pvp_round_id,
        created_at,
        updated_at
      FROM battle_report_generations
      WHERE ${whereSql}
      ORDER BY ${orderBySql}
      LIMIT ? OFFSET ?`,
      [...params, safeLimit, safeOffset]
    )) as any;

    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as BattleReportGenerationRowLite[];
    }
    return [];
  } catch (error) {
    console.error('读取 battle_report_generations(user) 失败:', error);
    return [];
  }
}

export async function countBattleReportGenerationsByUserId(
  userId: number,
  filter?: BattleReportGenerationsListFilter
): Promise<number> {
  try {
    const { whereSql, params } = buildBattleReportGenerationsWhereClause(userId, filter);
    const result = (await queryFromD1(
      `SELECT COUNT(1) AS total FROM battle_report_generations WHERE ${whereSql}`,
      params
    )) as any;
    const row = result?.result?.[0]?.results?.[0];
    const total = typeof row?.total === 'number' ? row.total : Number(row?.total);
    return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  } catch (error) {
    console.error('统计 battle_report_generations(user) 失败:', error);
    return 0;
  }
}

export function buildBattleReportGenerationsWhereClause(
  userId: number,
  filter?: BattleReportGenerationsListFilter
): { whereSql: string; params: unknown[]; orderBySql: string } {
  const where: string[] = ['user_id = ?'];
  const params: unknown[] = [userId];

  const status = filter?.status;
  if (status === 'completed' || status === 'aborted' || status === 'failed') {
    where.push('status = ?');
    params.push(status);
  }

  const generationMode = filter?.generationMode;
  if (generationMode === 'stream' || generationMode === 'non-stream') {
    where.push('generation_mode = ?');
    params.push(generationMode);
  }

  const mode = typeof filter?.mode === 'string' ? filter.mode.trim() : '';
  if (mode) {
    where.push('mode = ?');
    params.push(mode);
  }

  if (filter?.pvpOnly) {
    where.push('pvp_match_id IS NOT NULL');
  }

  const titleQuery = typeof filter?.titleQuery === 'string' ? filter.titleQuery.trim() : '';
  if (titleQuery) {
    const safe = titleQuery.length > 120 ? titleQuery.slice(0, 120) : titleQuery;
    const pattern = `%${safe}%`;
    where.push('(headline LIKE ? OR scenario_title LIKE ?)');
    params.push(pattern, pattern);
  }

  const sort = filter?.sort;
  const orderBySql = sort === 'started_at_asc' ? 'started_at ASC' : 'started_at DESC';

  return { whereSql: where.join(' AND '), params, orderBySql };
}

export async function updateBattleReportGenerationCombatantsWriteResult(
  id: string,
  payload: { ok: boolean; expectedRows: number; errorMessage?: string | null }
): Promise<boolean> {
  try {
    const nowIso = new Date().toISOString();
    const sql = `
      UPDATE battle_report_generations
      SET combatants_write_ok = ?,
          combatants_row_count = ?,
          combatants_write_error = ?,
          updated_at = ?
      WHERE id = ?;
    `;
    const params: unknown[] = [
      payload.ok ? 1 : 0,
      payload.expectedRows,
      payload.ok ? null : (payload.errorMessage || 'unknown error'),
      nowIso,
      id,
    ];
    const result = (await queryFromD1(sql, params)) as any;
    return Boolean(result?.success);
  } catch (error) {
    console.error('更新 battle_report_generations.combatants_* 失败:', error);
    return false;
  }
}

export async function updateBattleReportGenerationExtraJson(
  id: string,
  extraJson: Record<string, unknown> | null
): Promise<boolean> {
  try {
    const nowIso = new Date().toISOString();
    const sql = `
      UPDATE battle_report_generations
      SET extra_json = ?,
          updated_at = ?
      WHERE id = ?;
    `;
    const params: unknown[] = [extraJson ? JSON.stringify(extraJson) : null, nowIso, id];
    const result = (await queryFromD1(sql, params)) as any;
    return Boolean(result?.success);
  } catch (error) {
    console.error('更新 battle_report_generations.extra_json 失败:', error);
    return false;
  }
}
