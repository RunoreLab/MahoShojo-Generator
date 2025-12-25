import { countBattleReportGenerationsByUserId, getBattleReportGenerationsByUserIdLite } from '@/lib/d1';
import { json, requireAuthUser } from '@/lib/pvp/server';
import { quickCheck } from '@/lib/sensitive-word-filter';

export const runtime = 'edge';

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const url = new URL(req.url);
  const page = clampInt(url.searchParams.get('page'), 1, 1, 10_000);
  const pageSize = clampInt(url.searchParams.get('pageSize'), 10, 1, 30);
  const offset = (page - 1) * pageSize;

  const [total, rows] = await Promise.all([
    countBattleReportGenerationsByUserId(auth.user.id),
    getBattleReportGenerationsByUserIdLite(auth.user.id, pageSize, offset),
  ]);

  const records = await Promise.all(
    rows.map(async (r) => {
      const flaggedSensitive = Boolean(r.output_has_sensitive_words);
      const outputPreview = typeof r.output_preview === 'string' ? r.output_preview : null;
      const needsCheck = Boolean(outputPreview && outputPreview.trim());
      const sensitiveCheck = !flaggedSensitive && needsCheck ? await quickCheck(outputPreview!) : null;
      const contentBlocked = flaggedSensitive || Boolean(sensitiveCheck?.hasSensitiveWords);

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
        contentBlocked,
        outputHasShieldWords: Boolean(r.output_has_shield_words),
        pvpRoomId: r.pvp_room_id,
        pvpMatchId: r.pvp_match_id,
        pvpRoundId: r.pvp_round_id,
      };
    })
  );

  return json({
    success: true,
    page,
    pageSize,
    total,
    records,
  });
}

