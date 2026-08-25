import { getRequestUrl } from '@/lib/request-url';
import {
  countBattleReportGenerationsByUserId,
  getBattleReportGenerationsByUserIdLite,
  type BattleReportGenerationsListFilter,
} from '@/lib/database/battle-report-generations';
import { extractBattleReportGenerationErrorMessage } from '@/lib/arena/battle-report-record-utils';
import { json, requireAuthUser } from '@/lib/pvp/server';

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

const clampString = (value: unknown, maxLen: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return trimmed.slice(0, maxLen);
  return trimmed;
};

const parseBool = (value: unknown): boolean => {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const url = getRequestUrl(req);
  const page = clampInt(url.searchParams.get('page'), 1, 1, 10_000);
  const pageSize = clampInt(url.searchParams.get('pageSize'), 10, 1, 30);
  const offset = (page - 1) * pageSize;

  const status = clampString(url.searchParams.get('status'), 32);
  const mode = clampString(url.searchParams.get('mode'), 64);
  const generationMode = clampString(url.searchParams.get('generationMode'), 32);
  const titleQuery = clampString(url.searchParams.get('q'), 120);
  const pvpOnly = parseBool(url.searchParams.get('pvpOnly'));
  const sort = clampString(url.searchParams.get('sort'), 32);

  const filter: BattleReportGenerationsListFilter = {};
  if (status === 'completed' || status === 'aborted' || status === 'failed') filter.status = status;
  if (mode) filter.mode = mode;
  if (generationMode === 'stream' || generationMode === 'non-stream') filter.generationMode = generationMode;
  if (titleQuery) filter.titleQuery = titleQuery;
  if (pvpOnly) filter.pvpOnly = true;
  if (sort === 'started_at_asc' || sort === 'started_at_desc') filter.sort = sort;

  const [total, rows] = await Promise.all([
    countBattleReportGenerationsByUserId(auth.user.id, filter),
    getBattleReportGenerationsByUserIdLite(auth.user.id, pageSize, offset, filter),
  ]);

  const records = rows.map((r) => {
    const flaggedSensitive = Boolean(r.output_has_sensitive_words);
    const outputPreview = typeof r.output_preview === 'string' ? r.output_preview : null;
    const contentBlocked = flaggedSensitive;

    return {
      id: r.id,
      startedAt: r.started_at,
      status: r.status,
      endpoint: r.endpoint,
      generationMode: r.generation_mode,
      mode: r.mode,
      headline: r.headline,
      winner: r.winner,
      hasPreview: Boolean(outputPreview && outputPreview.trim()) && !contentBlocked,
      canRegenerate: !contentBlocked && (r.status === 'completed' || Boolean(outputPreview && outputPreview.trim())),
      contentBlocked,
      errorMessage: extractBattleReportGenerationErrorMessage(r.extra_json),
      outputHasShieldWords: Boolean(r.output_has_shield_words),
      pvpRoomId: r.pvp_room_id,
      pvpMatchId: r.pvp_match_id,
      pvpRoundId: r.pvp_round_id,
    };
  });

  return json({
    success: true,
    page,
    pageSize,
    total,
    records,
  });
}

export const appRouteHandler = handler;
export default appRouteHandler;
