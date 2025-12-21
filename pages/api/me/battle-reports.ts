import { getBattleReportGenerationsByUserIdLite } from '@/lib/d1';
import { json, requireAuthUser } from '@/lib/pvp/server';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit && Number.isFinite(Number(rawLimit)) ? Math.floor(Number(rawLimit)) : 20;

  const rows = await getBattleReportGenerationsByUserIdLite(auth.user.id, limit);

  return json({
    success: true,
    records: rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      status: r.status,
      endpoint: r.endpoint,
      generationMode: r.generation_mode,
      mode: r.mode,
      headline: r.headline,
      winner: r.winner,
      outputPreview: r.output_preview,
      pvpRoomId: r.pvp_room_id,
      pvpMatchId: r.pvp_match_id,
      pvpRoundId: r.pvp_round_id,
    })),
  });
}

