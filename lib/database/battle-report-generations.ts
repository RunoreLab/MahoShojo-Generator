import { queryFromD1, generateUUID } from '@/lib/d1';

export type BattleReportGenerationStatus = 'completed' | 'aborted' | 'failed';

export interface BattleReportGenerationInsert {
  id?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: BattleReportGenerationStatus;

  ip?: string | null;
  ipAnonymized?: string | null;
  userAgent?: string | null;
  cfRay?: string | null;
  cfCountry?: string | null;

  userId?: number | null;
  username?: string | null;
  userPrefix?: string | null;

  mode: string;
  scenarioTitle?: string | null;
  language?: string | null;
  selectedLevel?: string | null;
  storyLength?: string | null;

  readArenaHistory?: boolean | null;
  arenaHistoryReadLimit?: number | null;
  writeArenaHistory?: boolean | null;
  readCurrentState?: boolean | null;
  writeCurrentState?: boolean | null;

  userGuidancePreview?: string | null;
  adjudicationEventsPreview?: string | null;

  customProviderId?: string | null;
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
        ip,
        ip_anonymized,
        user_agent,
        cf_ray,
        cf_country,
        user_id,
        username,
        user_prefix,
        mode,
        scenario_title,
        language,
        selected_level,
        story_length,
        read_arena_history,
        arena_history_read_limit,
        write_arena_history,
        read_current_state,
        write_current_state,
        user_guidance_preview,
        adjudication_events_preview,
        custom_provider_id,
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
        extra_json,
        created_at,
        updated_at
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?
      );
    `;

    const params: unknown[] = [
      id,
      payload.startedAt,
      payload.endedAt,
      payload.durationMs,
      payload.status,
      payload.ip ?? null,
      payload.ipAnonymized ?? null,
      payload.userAgent ?? null,
      payload.cfRay ?? null,
      payload.cfCountry ?? null,
      payload.userId ?? null,
      payload.username ?? null,
      payload.userPrefix ?? null,
      payload.mode,
      payload.scenarioTitle ?? null,
      payload.language ?? null,
      payload.selectedLevel ?? null,
      payload.storyLength ?? null,
      typeof payload.readArenaHistory === 'boolean' ? (payload.readArenaHistory ? 1 : 0) : null,
      payload.arenaHistoryReadLimit ?? null,
      typeof payload.writeArenaHistory === 'boolean' ? (payload.writeArenaHistory ? 1 : 0) : null,
      typeof payload.readCurrentState === 'boolean' ? (payload.readCurrentState ? 1 : 0) : null,
      typeof payload.writeCurrentState === 'boolean' ? (payload.writeCurrentState ? 1 : 0) : null,
      payload.userGuidancePreview ?? null,
      payload.adjudicationEventsPreview ?? null,
      payload.customProviderId ?? null,
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
