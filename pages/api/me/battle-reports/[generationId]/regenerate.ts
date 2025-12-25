import { getBattleReportGenerationByIdLite, isUserInPvpMatch } from '@/lib/d1';
import { hydrateBattleReportCardFromGenerationRecord } from '@/lib/arena/battle-report-card-fallback';
import { json, readJson, requireAuthUser } from '@/lib/pvp/server';
import { quickCheck } from '@/lib/sensitive-word-filter';

export const runtime = 'edge';

type RegenerateBody = { userGuidance?: unknown };

const getGenerationIdFromUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    // /api/me/battle-reports/:generationId/regenerate
    const idx = parts.findIndex((p) => p === 'battle-reports');
    if (idx === -1) return null;
    return parts[idx + 1] || null;
  } catch {
    return null;
  }
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const generationId = getGenerationIdFromUrl(req.url);
  if (!generationId) return json({ error: '缺少 generationId' }, { status: 400 });

  const record = await getBattleReportGenerationByIdLite(generationId);
  if (!record) return json({ error: '记录不存在' }, { status: 404 });

  const isOwner = record.user_id === auth.user.id;
  const canReadByPvp = record.pvp_match_id ? await isUserInPvpMatch(record.pvp_match_id, auth.user.id) : false;
  if (!isOwner && !canReadByPvp) return json({ error: '记录不存在' }, { status: 404 });

  const outputPreview = typeof record.output_preview === 'string' ? record.output_preview : '';
  const flaggedSensitive = Boolean(record.output_has_sensitive_words);
  const needsCheck = Boolean(outputPreview && outputPreview.trim());
  const sensitiveCheck = !flaggedSensitive && needsCheck ? await quickCheck(outputPreview) : null;
  const contentBlocked = flaggedSensitive || Boolean(sensitiveCheck?.hasSensitiveWords);

  if (contentBlocked) {
    return json({ error: '该记录包含敏感词，已禁止浏览与重生。' }, { status: 403 });
  }

  const body = await readJson<RegenerateBody>(req);
  if ('response' in body) return body.response;
  const userGuidance = typeof body.data.userGuidance === 'string' ? body.data.userGuidance.trim() : '';

  const hydrated = await hydrateBattleReportCardFromGenerationRecord({
    generationMode: record.generation_mode,
    endpoint: record.endpoint,
    mode: record.mode,
    scenarioTitle: record.scenario_title,
    headline: record.headline,
    winner: record.winner,
    outputPreview: outputPreview,
    promptTokens: record.prompt_tokens,
    completionTokens: record.completion_tokens,
    totalTokens: record.total_tokens,
    cachedTokens: record.cached_tokens,
    reasoningTokens: record.reasoning_tokens,
    userGuidance,
  });

  return json({ success: true, report: hydrated.report, liveBody: hydrated.liveBody, generationId });
}
