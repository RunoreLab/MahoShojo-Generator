import { adminAggregateRows } from './analytics';
import type { AdminReadDatabase } from './read-models';

type Row = Record<string, string | number | null>;
export type AdminPvpRoomState = { id: string; host_user_id: number; status: string; phase: string; current_match_id: string | null;
  rules_json: string; version: number; created_at: string; updated_at: string; last_activity_at: string | null; expires_at: string | null };
export type AdminPvpRoundState = { id: string; room_id: string; match_id: string | null; status: string; round_index: number; battle_generation_id: string | null; result_json: string | null; created_at: string };
const validateId = (id: string): void => { if (typeof id !== 'string' || !id || id.length > 128) throw new Error('ADMIN_PVP_ID_INVALID'); };
const bounded = <T>(items: T[], limit = 100) => ({ items: items.slice(0, limit), hasMore: items.length > limit });
export function parseAdminPvpRules(value: string): Record<string, unknown> {
  if (value.length > 1_000_000) throw new Error('ADMIN_PVP_RULES_INVALID');
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('ADMIN_PVP_RULES_INVALID');
  return parsed as Record<string, unknown>;
}
export async function readAdminPvpRoomState(db: AdminReadDatabase, id: string): Promise<AdminPvpRoomState | null> {
  validateId(id);
  const rows = await adminAggregateRows<AdminPvpRoomState>(db, 'SELECT id,host_user_id,status,phase,current_match_id,rules_json,version,created_at,updated_at,last_activity_at,expires_at FROM pvp_rooms WHERE id=?', [id]);
  return rows[0] ?? null;
}
export async function readAdminPvpLatestRound(db: AdminReadDatabase, matchId: string): Promise<AdminPvpRoundState | null> {
  const rows = await adminAggregateRows<AdminPvpRoundState>(db, 'SELECT id,room_id,match_id,status,round_index,battle_generation_id,result_json,created_at FROM pvp_rounds WHERE match_id=? ORDER BY round_index DESC,created_at DESC,id DESC LIMIT 1', [matchId]);
  return rows[0] ?? null;
}

/** A resolving round with no persisted terminal evidence is unknown, even after a long timeout. */
export const PVP_NO_UNFINISHED_GENERATION_SQL = `NOT EXISTS (
  SELECT 1 FROM pvp_rounds safety_round LEFT JOIN battle_report_generations safety_generation ON safety_generation.id=safety_round.battle_generation_id
  WHERE safety_round.room_id=pvp_rooms.id AND (
    (safety_round.status='resolving' AND safety_round.result_json IS NULL AND
      (safety_generation.id IS NULL OR safety_generation.status NOT IN ('completed','aborted','failed')))
    OR (safety_generation.id IS NOT NULL AND safety_generation.status NOT IN ('completed','aborted','failed'))
    OR (safety_generation.extra_json IS NOT NULL AND (NOT json_valid(safety_generation.extra_json)
      OR (json_type(safety_generation.extra_json,'$.finalizationCompleted') IS NOT NULL AND json_extract(safety_generation.extra_json,'$.finalizationCompleted')!=1)))
  )
) AND NOT EXISTS (
  SELECT 1 FROM battle_report_generations active_generation WHERE active_generation.pvp_room_id=pvp_rooms.id
    AND active_generation.status NOT IN ('completed','aborted','failed')
)`;

export async function readAdminPvpRoomDetail(db: AdminReadDatabase, id: string) {
  const room = await readAdminPvpRoomState(db, id);
  if (!room) return null;
  let rules: Row | null = null;
  try {
    const parsed = parseAdminPvpRules(room.rules_json);
    rules = Object.fromEntries(['mode', 'participants', 'submissionMode', 'cardsPerPlayer', 'dealPerPlayer', 'drawSource', 'generationMode', 'language', 'storyLength']
      .map((key) => [key, typeof parsed[key] === 'string' || typeof parsed[key] === 'number' ? parsed[key] : null])) as Row;
  } catch { /* Invalid persisted rules are a visible diagnostic, never passed to the browser raw. */ }
  const members = await adminAggregateRows<Row>(db, 'SELECT p.user_id,p.role,p.seat,p.joined_at,u.username FROM pvp_room_players p LEFT JOIN users u ON u.id=p.user_id WHERE p.room_id=? ORDER BY p.seat,p.user_id LIMIT 101', [id]);
  const matches = await listAdminPvpMatches(db, { roomId: id });
  const rounds = await adminAggregateRows<Row>(db, 'SELECT id,room_id,match_id,round_index,status,battle_generation_id,winner_user_id,winner_name,created_at FROM pvp_rounds WHERE room_id=? ORDER BY created_at DESC,id DESC LIMIT 101', [id]);
  const chats = await adminAggregateRows<Row>(db, 'SELECT id,sender_user_id,sender_role,sender_username,rendered_text,sticker_id,emoji_text,created_at FROM pvp_room_chat_messages WHERE room_id=? ORDER BY id DESC LIMIT 101', [id]);
  const submissions = await adminAggregateRows<Row>(db, "SELECT user_id,created_at,updated_at,CASE WHEN json_valid(submission_json) THEN json_array_length(submission_json,'$.cards') ELSE NULL END AS card_count FROM pvp_room_submissions WHERE room_id=? ORDER BY user_id LIMIT 101", [id]);
  const hands = await adminAggregateRows<Row>(db, "SELECT user_id,created_at,updated_at,CASE WHEN json_valid(hand_json) THEN json_array_length(hand_json,'$.cards') ELSE NULL END AS hand_count,CASE WHEN json_valid(hand_json) THEN json_array_length(hand_json,'$.discarded') ELSE NULL END AS discarded_count FROM pvp_room_hands WHERE room_id=? ORDER BY user_id LIMIT 101", [id]);
  const snapshots = await adminAggregateRows<Row>(db, 'SELECT id,owner_user_id,name,card_type,source_updated_at,created_at FROM pvp_room_card_snapshots WHERE room_id=? ORDER BY created_at DESC,id DESC LIMIT 101', [id]);
  const safety = await adminAggregateRows<{ safe: number }>(db, `SELECT CASE WHEN ${PVP_NO_UNFINISHED_GENERATION_SQL} THEN 1 ELSE 0 END AS safe FROM pvp_rooms WHERE id=?`, [id]);
  return { room: { id: room.id, host_user_id: room.host_user_id, status: room.status, phase: room.phase, version: room.version,
    current_match_id: room.current_match_id, created_at: room.created_at, updated_at: room.updated_at, last_activity_at: room.last_activity_at, expires_at: room.expires_at },
    rules, rulesValid: rules !== null, generationState: safety[0]?.safe === 1 ? 'terminal-or-idle' : 'running-or-unknown',
    members: bounded(members), matches, rounds: bounded(rounds), chats: bounded(chats), submissions: bounded(submissions), hands: bounded(hands), snapshots: bounded(snapshots) };
}

export async function listAdminPvpMatches(db: AdminReadDatabase, input: { roomId?: string; userId?: number; status?: string; cursor?: string; limit?: number } = {}) {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('ADMIN_PVP_LIMIT_INVALID');
  const clauses: string[] = []; const parameters: unknown[] = [];
  if (input.roomId) { validateId(input.roomId); clauses.push('m.room_id=?'); parameters.push(input.roomId); }
  if (input.userId !== undefined) { if (!Number.isSafeInteger(input.userId) || input.userId < 1) throw new Error('ADMIN_PVP_USER_INVALID'); clauses.push('EXISTS (SELECT 1 FROM pvp_match_players p WHERE p.match_id=m.id AND p.user_id=?)'); parameters.push(input.userId); }
  if (input.status) { if (!['active', 'completed', 'aborted'].includes(input.status)) throw new Error('ADMIN_PVP_STATUS_INVALID'); clauses.push('m.status=?'); parameters.push(input.status); }
  if (input.cursor) { validateId(input.cursor); clauses.push('m.id<?'); parameters.push(input.cursor); }
  const rows = await adminAggregateRows<Row>(db, `SELECT m.id,m.room_id,m.status,m.participants,m.started_at,m.ended_at,m.winner_user_id,m.created_at,m.updated_at FROM pvp_matches m${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY m.id DESC LIMIT ?`, [...parameters, limit + 1]);
  return { ...bounded(rows, limit), nextCursor: rows.length > limit ? String(rows[limit - 1].id) : null };
}

export async function readAdminPvpMatchDetail(db: AdminReadDatabase, id: string) {
  validateId(id);
  const matches = await adminAggregateRows<Row>(db, 'SELECT id,room_id,status,participants,started_at,ended_at,winner_user_id,created_at,updated_at FROM pvp_matches WHERE id=?', [id]);
  if (!matches.length) return null;
  const players = await adminAggregateRows<Row>(db, 'SELECT user_id,seat,username,user_prefix,joined_at FROM pvp_match_players WHERE match_id=? ORDER BY seat,user_id LIMIT 101', [id]);
  const rounds = await adminAggregateRows<Row>(db, 'SELECT id,round_index,status,battle_generation_id,winner_user_id,winner_name,created_at FROM pvp_rounds WHERE match_id=? ORDER BY round_index DESC,id DESC LIMIT 101', [id]);
  const choices = await adminAggregateRows<Row>(db, `SELECT c.round_id,c.user_id,c.created_at,c.updated_at,
    CASE WHEN json_valid(c.choice_ref_json) THEN json_extract(c.choice_ref_json,'$.id') ELSE NULL END AS snapshot_id
    FROM pvp_round_choices c JOIN pvp_rounds r ON r.id=c.round_id WHERE r.match_id=? ORDER BY r.round_index DESC,c.user_id LIMIT 601`, [id]);
  return { match: matches[0], players: bounded(players), rounds: bounded(rounds), choices: bounded(choices, 600) };
}

export async function readAdminArenaRisk(db: AdminReadDatabase, now = new Date()) {
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const since7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const since1 = new Date(now.getTime() - 86_400_000).toISOString();
  const end = now.toISOString();
  const summary = await adminAggregateRows<Row>(db, `SELECT count(*) AS total30d,count(DISTINCT user_id) AS distinct_users30d,count(DISTINCT pair_key) AS distinct_pairs30d,
    coalesce(sum(status='applied'),0) AS applied30d,coalesce(sum(status='skipped'),0) AS skipped30d,coalesce(sum(status='failed'),0) AS failed30d,
    coalesce(sum(created_at>=? AND status='applied'),0) AS applied7d,coalesce(sum(created_at>=? AND status='skipped'),0) AS skipped7d,coalesce(sum(created_at>=? AND status='failed'),0) AS failed7d,
    coalesce(sum(created_at>=? AND status='applied'),0) AS applied24h,coalesce(sum(created_at>=? AND status='skipped'),0) AS skipped24h,coalesce(sum(created_at>=? AND status='failed'),0) AS failed24h
    FROM arena_rating_events WHERE created_at>=? AND created_at<=?`, [since7, since7, since7, since1, since1, since1, since30, end]);
  const skipReasons = await adminAggregateRows<Row>(db, 'SELECT skip_reason,count(*) AS count30d,sum(created_at>=?) AS count7d,sum(created_at>=?) AS count24h FROM arena_rating_events WHERE created_at>=? AND created_at<=? AND skip_reason IS NOT NULL GROUP BY skip_reason ORDER BY count30d DESC,skip_reason LIMIT 100', [since7, since1, since30, end]);
  const topUsers = await adminAggregateRows<Row>(db, "SELECT user_id,count(*) AS events30d,sum(status='applied') AS applied30d,sum(status='skipped') AS skipped30d,count(DISTINCT pair_key) AS pair_count30d FROM arena_rating_events WHERE created_at>=? AND created_at<=? AND user_id IS NOT NULL GROUP BY user_id ORDER BY events30d DESC,user_id LIMIT 100", [since30, end]);
  const topPairs = await adminAggregateRows<Row>(db, "SELECT pair_key,a_entity_type,a_entity_id,b_entity_type,b_entity_id,count(*) AS events30d,sum(status='applied') AS applied30d,sum(status='skipped') AS skipped30d,count(DISTINCT user_id) AS distinct_users30d,max(created_at) AS last_event_at FROM arena_rating_events WHERE created_at>=? AND created_at<=? GROUP BY pair_key,a_entity_type,a_entity_id,b_entity_type,b_entity_id ORDER BY events30d DESC,pair_key LIMIT 100", [since30, end]);
  return { generatedAt: end, summary: summary[0], skipReasons, topUsers, topPairs };
}
