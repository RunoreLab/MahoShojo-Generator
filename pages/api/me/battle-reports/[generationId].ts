import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import {
  getBattleReportGenerationByIdLite,
  updateBattleReportGenerationOutputHasSensitiveWords,
} from '@/lib/database/battle-report-generations';
import {
  extractBattleReportGenerationErrorMessage,
  loadBattleReportGenerationOutputText,
} from '@/lib/arena/battle-report-record-utils';
import { getBattleReportGenerationCombatantsByGenerationId } from '@/lib/database/battle-report-generation-combatants';
import { parseGenerationCombatantsFallback } from '@/lib/database/arena-ratings';
import { isUserInPvpMatch } from '@/lib/database/pvp';
import { json, requireAuthUser } from '@/lib/pvp/server';
import { quickCheck } from '@/lib/sensitive-word-filter';

const getGenerationIdFromUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    // /api/me/battle-reports/:generationId
    const idx = parts.findIndex((p) => p === 'battle-reports');
    if (idx === -1) return null;
    return parts[idx + 1] || null;
  } catch {
    return null;
  }
};

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const generationId = getGenerationIdFromUrl(req.url);
  if (!generationId) return json({ error: '缺少 generationId' }, { status: 400 });

  const record = await getBattleReportGenerationByIdLite(generationId);
  if (!record) return json({ error: '记录不存在' }, { status: 404 });

  const isOwner = record.user_id === auth.user.id;
  const canReadByPvp = record.pvp_match_id ? await isUserInPvpMatch(record.pvp_match_id, auth.user.id) : false;
  if (!isOwner && !canReadByPvp) return json({ error: '无权限' }, { status: 403 });

  const tableCombatants = await getBattleReportGenerationCombatantsByGenerationId(generationId);
  const combatants = tableCombatants.length > 0 ? tableCombatants : parseGenerationCombatantsFallback(generationId, record.extra_json);

  const output = await loadBattleReportGenerationOutputText({
    generationId: record.id,
    outputPreview: record.output_preview,
  });
  const outputPreview = output.outputText || null;
  const hasPreviewText = Boolean(outputPreview && outputPreview.trim());

  let contentBlocked = record.output_has_sensitive_words === 1;
  if (hasPreviewText) {
    const sensitiveCheck = await quickCheck(outputPreview!);
    contentBlocked = Boolean(sensitiveCheck.hasSensitiveWords);
    await updateBattleReportGenerationOutputHasSensitiveWords(record.id, contentBlocked);
  }

  const canRegenerate = output.hasStoredOutput && !output.readError && !contentBlocked;
  const errorMessage = extractBattleReportGenerationErrorMessage(record.extra_json);

  return json({
    success: true,
    record: {
      id: record.id,
      startedAt: record.started_at,
      endedAt: record.ended_at,
      durationMs: record.duration_ms,
      status: record.status,
      endpoint: record.endpoint,
      generationMode: record.generation_mode,
      mode: record.mode,
      scenarioTitle: record.scenario_title,
      language: record.language,
      storyLength: record.story_length,
      headline: record.headline,
      winner: record.winner,
      outputPreview: contentBlocked ? null : outputPreview,
      hasPreview: Boolean(outputPreview && outputPreview.trim()) && !contentBlocked,
      contentBlocked,
      canRegenerate,
      outputSource: output.source,
      outputReadError: output.readError,
      errorMessage,
      outputHasShieldWords: Boolean(record.output_has_shield_words),
      pvpRoomId: record.pvp_room_id,
      pvpMatchId: record.pvp_match_id,
      pvpRoundId: record.pvp_round_id,
    },
    combatants: combatants.map((c) => ({
      sortIndex: c.sort_index,
      name: c.name,
      type: c.type,
      templateId: c.template_id,
      isNative: Boolean(c.is_native),
      isPreset: Boolean(c.is_preset),
      teamId: c.team_id,
      characterGuidance: typeof c.character_guidance === 'string' && c.character_guidance.trim() ? c.character_guidance : null,
      dataCardId: c.data_card_id,
      dataCardUpdatedAt: c.data_card_updated_at,
    })),
  });
}

export default withPagesApiResponse(handler);
