import { getPvpRoomBrowseRows } from '@/lib/database/pvp';
import { parsePvpRoomInternalState } from '@/lib/pvp/bot/room';
import { canJoinPvpRoomFromBrowse, canSpectatePvpRoomFromBrowse } from '@/lib/pvp/room-browse';
import { getPvpScenarioTitle, parsePvpScenarioSelection } from '@/lib/pvp/scenario';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpRoomRules } from '@/lib/pvp/types';

export const runtime = 'edge';

type BrowseRoomItem = {
  roomId: string;
  host: { userId: number; username: string; prefix?: string | null };
  status: string;
  phase: string;
  hasPassword: boolean;
  players: { humans: number; bots: number; total: number; max: number; slotsLeft: number };
  mode: string;
  rules: PvpRoomRules;
  scenarioTitle?: string | null;
  updatedAt: string;
  lastActivityAt: string | null;
  expiresAt: string | null;
  joinable: boolean;
  spectatable: boolean;
  allowSpectators: boolean;
};

const parseBool = (raw: string | null): boolean | null => {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return null;
};

async function browseHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() || '';
  const mode = url.searchParams.get('mode')?.trim() || 'all';
  const phase = url.searchParams.get('phase')?.trim() || 'any';
  const passwordRaw = url.searchParams.get('password')?.trim() || 'any';
  const includeUnavailable =
    parseBool(url.searchParams.get('includeUnavailable')) === true || parseBool(url.searchParams.get('includeFull')) === true;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw && Number.isFinite(Number(limitRaw)) ? Math.floor(Number(limitRaw)) : 60;

  const password: 'any' | 'yes' | 'no' = passwordRaw === 'yes' || passwordRaw === 'no' ? (passwordRaw as any) : 'any';
  const safePhase: 'any' | 'waiting' | 'submitting' = phase === 'waiting' || phase === 'submitting' ? (phase as any) : 'any';

  const rows = await getPvpRoomBrowseRows({
    query: q || undefined,
    mode: mode || 'all',
    password,
    phase: safePhase,
    phaseScope: 'open',
    limit,
    offset: 0,
  });

  const rooms: BrowseRoomItem[] = [];
  for (const row of rows) {
    const internalParsed = parsePvpRoomInternalState(row.rules_json);
    if ('error' in internalParsed) continue;
    const rules = internalParsed.internal.rules;
    const bots = internalParsed.internal.bots;
    const maxPlayers = Number.isFinite(rules.participants) ? Math.max(2, Math.min(6, Math.floor(rules.participants))) : 2;
    const humans = Number.isFinite(row.player_count) ? Math.max(0, Math.floor(row.player_count)) : 0;
    const botCount = bots.length;
    const total = humans + botCount;
    const slotsLeft = maxPlayers - total;
    const hasPassword = Boolean(row.join_code_hash);
    const allowSpectators = rules.allowSpectators !== false;
    const joinable = canJoinPvpRoomFromBrowse({ status: row.status, phase: row.phase, slotsLeft });
    const spectatable = canSpectatePvpRoomFromBrowse({ status: row.status, phase: row.phase, allowSpectators });
    const enterable = joinable || spectatable;

    if (!includeUnavailable && !enterable) continue;

    const scenarioSelection = parsePvpScenarioSelection((internalParsed.internal.raw as any)?._scenario);
    const scenarioTitle = scenarioSelection ? getPvpScenarioTitle(scenarioSelection) : null;

    rooms.push({
      roomId: row.id,
      host: { userId: row.host_user_id, username: row.host_username, prefix: row.host_prefix },
      status: row.status,
      phase: row.phase,
      hasPassword,
      players: { humans, bots: botCount, total, max: maxPlayers, slotsLeft: Math.max(0, slotsLeft) },
      mode: rules.mode,
      rules,
      ...(rules.mode === 'scenario' ? { scenarioTitle } : {}),
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at,
      expiresAt: row.expires_at,
      joinable,
      spectatable,
      allowSpectators,
    });
  }

  return json({ success: true, rooms });
}

export default withPvpErrorBoundary(browseHandler);
