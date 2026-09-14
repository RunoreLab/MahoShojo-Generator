import { z } from 'zod';
import { adminAggregateRows } from '../analytics';
import { PVP_NO_UNFINISHED_GENERATION_SQL, parseAdminPvpRules, readAdminPvpLatestRound, readAdminPvpRoomState } from '../arena-management';
import { INITIAL_RATING, clearPvpRoomRuntimeFromRulesJson, requiresPvpSubmissionPhase, canForcePendingAction, computeLastPendingChooseAction, computeLastPendingConfirmAction, computeLastPendingSubmissionAction } from '../arena-policy';
import { buildBotSubmissionPayload, inferPvpCombatantTypeFromJson, type PvpPublicCard } from '../arena-submission';
import { normalizePvpRoomCardRange } from '../arena-card-range';
import { BUNDLED_PRESET_FILENAMES, getBundledPresetData } from '../../generated/pvp-presets';
import type { AdminDatabase } from '../database';
import { executeAdminOperation, type AdminGuardedStatement } from '../operations';
import { commonInput, defineAction, fields, mutationInput, snapshot, type AdminActionContext, type AdminBusinessAction } from './core';

const interventionInput = z.object({ ...commonInput, id: z.string().min(1).max(128), expectedVersion: z.number().int().nonnegative(), cleanupMode: z.enum(['preserve', 'runtime', 'ephemeral']).default('runtime') }).strict();
type Intervention = z.infer<typeof interventionInput>;
type InterventionKind = 'close' | 'restart' | 'recover' | 'clear-ephemeral' | 'force-submit' | 'force-choose' | 'force-confirm';
const runtimeTables = ['pvp_room_hands', 'pvp_room_submissions', 'pvp_room_card_snapshots'] as const;

async function intervene(db: AdminDatabase, input: Intervention, context: AdminActionContext, kind: InterventionKind) {
  const room = await readAdminPvpRoomState(db, input.id);
  if (!room) throw new Error('ADMIN_PVP_ROOM_NOT_FOUND');
  const rawRules = parseAdminPvpRules(room.rules_json);
  const round = room.current_match_id ? await readAdminPvpLatestRound(db, room.current_match_id) : null;
  const now = new Date().toISOString();
  const members = await adminAggregateRows<{ userId: number }>(db, "SELECT user_id AS userId FROM pvp_room_players WHERE room_id=? AND role='player' ORDER BY user_id LIMIT 7", [room.id]);
  if (members.length > 6) throw new Error('ADMIN_PVP_PLAYER_LIMIT');
  let nextPhase = room.phase; let nextStatus = room.status; let nextMatch = room.current_match_id; let rulesJson = room.rules_json;
  const additional: string[] = [PVP_NO_UNFINISHED_GENERATION_SQL]; const additionalBindings: unknown[] = [];
  additional.push("(SELECT count(*) FROM pvp_room_players WHERE room_id=pvp_rooms.id AND role='player')=?");
  additionalBindings.push(members.length);
  if (members.length) {
    additional.push(`NOT EXISTS (SELECT 1 FROM pvp_room_players WHERE room_id=pvp_rooms.id AND role='player' AND user_id NOT IN (${members.map(() => '?').join(',')}))`);
    additionalBindings.push(...members.map((member) => member.userId));
  }
  const effects: AdminGuardedStatement[] = [];
  if (round) {
    additional.push('(SELECT id FROM pvp_rounds WHERE match_id=? ORDER BY round_index DESC,created_at DESC,id DESC LIMIT 1)=?', 'EXISTS (SELECT 1 FROM pvp_rounds WHERE id=? AND status=? AND result_json IS ? AND battle_generation_id IS ?)');
    additionalBindings.push(room.current_match_id, round.id, round.id, round.status, round.result_json, round.battle_generation_id);
  }
  const clearingRuntime = kind === 'restart' || kind === 'clear-ephemeral' || (kind === 'close' && input.cleanupMode !== 'preserve');
  const clearingEphemeral = kind === 'clear-ephemeral' || (kind === 'close' && input.cleanupMode === 'ephemeral');
  if (kind === 'close' || kind === 'restart') {
    rulesJson = clearPvpRoomRuntimeFromRulesJson(room.rules_json);
    nextMatch = null;
    if (kind === 'close') { nextStatus = 'closed'; nextPhase = 'closed'; }
    else {
      if (!Number.isInteger(rawRules.participants) || Number(rawRules.participants) < 2 || Number(rawRules.participants) > 6
        || !Number.isInteger(rawRules.cardsPerPlayer) || !['hostOnly', 'perPlayer'].includes(String(rawRules.submissionMode))) throw new Error('ADMIN_PVP_RULES_INVALID');
      nextStatus = 'open'; nextPhase = members.length >= Number(rawRules.participants) && requiresPvpSubmissionPhase({ submissionMode: String(rawRules.submissionMode), cardsPerPlayer: Number(rawRules.cardsPerPlayer) }) ? 'submitting' : 'waiting';
    }
    if (room.current_match_id) {
      const matches = await adminAggregateRows<{ status: string; updated_at: string; result_json: string | null }>(db, 'SELECT status,updated_at,result_json FROM pvp_matches WHERE id=? AND room_id=?', [room.current_match_id, room.id]);
      const match = matches[0];
      if (!match) additional.push('0=1');
      else {
        additional.push('EXISTS (SELECT 1 FROM pvp_matches WHERE id=? AND status=? AND updated_at=? AND result_json IS ?)');
        additionalBindings.push(room.current_match_id, match.status, match.updated_at, match.result_json);
        if (match.status === 'active') effects.push({ name: 'abort-match', sql: "UPDATE pvp_matches SET status='aborted',ended_at=?,updated_at=?,result_json=coalesce(result_json,?) WHERE id=? AND status='active' AND {{admin_guard}}",
          bindings: [now, now, JSON.stringify({ adminIntervention: { action: kind, at: now } }), room.current_match_id], expectedChanges: 1 });
      }
      if (round && !['completed', 'aborted'].includes(round.status)) effects.push({ name: 'abort-round', sql: "UPDATE pvp_rounds SET status='aborted',result_json=coalesce(result_json,?) WHERE id=? AND status=? AND {{admin_guard}}", bindings: [JSON.stringify({ adminIntervention: { action: kind, at: now } }), round.id, round.status], expectedChanges: 1 });
    }
  } else if (kind === 'recover') {
    additional.push("phase='resolving'");
    if (!round) additional.push('0=1');
    else {
      nextPhase = rawRules._winnerVote ? 'voting' : round.result_json ? 'reviewing' : 'choosing';
      if (round.status === 'resolving') effects.push({ name: 'recover-round', sql: 'UPDATE pvp_rounds SET status=? WHERE id=? AND status=\'resolving\' AND {{admin_guard}}', bindings: [round.result_json ? 'completed' : 'pending', round.id], expectedChanges: 1 });
    }
  } else if (kind === 'clear-ephemeral') {
    additional.push("status='closed'", "NOT EXISTS (SELECT 1 FROM pvp_matches WHERE room_id=pvp_rooms.id AND status='active')");
  } else if (kind === 'force-submit') {
    additional.push("phase='submitting'", "status='open'");
    const submissions = await adminAggregateRows<{ userId: number; updatedAt: string }>(db, 'SELECT user_id AS userId,updated_at AS updatedAt FROM pvp_room_submissions WHERE room_id=? ORDER BY user_id LIMIT 7', [room.id]);
    const pending = computeLastPendingSubmissionAction({ nowMs: Date.now(), phaseFallbackAt: room.last_activity_at ?? room.updated_at, players: members, submissions });
    if (!pending || !canForcePendingAction(pending, Date.now())) additional.push('0=1');
    else {
      const needed = rawRules.cardsPerPlayer;
      if (!Number.isInteger(needed) || Number(needed) < 1 || Number(needed) > 50 || rawRules.submissionMode === 'hostOnly') throw new Error('ADMIN_PVP_SUBMISSION_RULES_INVALID');
      const cardRange = normalizePvpRoomCardRange(rawRules);
      const conditions = ["CAST(d.is_public AS INTEGER)=1", "d.type='character'", "d.review_status='approved'", 'd.deleted_at IS NULL', 'length(d.data)<=262144'];
      const parameters: unknown[] = [];
      for (const [minimum, maximum, column] of [['minLikeCount', 'maxLikeCount', 'like_count'], ['minUsageCount', 'maxUsageCount', 'usage_count'], ['minFavoriteCount', 'maxFavoriteCount', 'favorite_count']] as const) {
        if (cardRange[minimum] !== null) { conditions.push(`d.${column}>=?`); parameters.push(cardRange[minimum]); }
        if (cardRange[maximum] !== null) { conditions.push(`d.${column}<=?`); parameters.push(cardRange[maximum]); }
      }
      const candidates = await adminAggregateRows<PvpPublicCard>(db, `SELECT d.id,d.name,d.data,d.updated_at,u.username,d.like_count,d.usage_count,d.favorite_count FROM data_cards d JOIN users u ON u.id=d.user_id WHERE ${conditions.join(' AND ')} ORDER BY random() LIMIT 32`, parameters);
      const payload = await buildBotSubmissionPayload({
        async getRandomPublicCard() { return candidates[Math.floor(Math.random() * candidates.length)] ?? null; },
        presetFilenames: BUNDLED_PRESET_FILENAMES,
        async loadPresetCard(_origin, filename) { const data = getBundledPresetData(filename); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('ADMIN_PRESET_UNAVAILABLE');
          const row = data as Record<string, unknown>; const name = row.codename || row.name || row.title;
          return { name: typeof name === 'string' ? name : '未命名', type: inferPvpCombatantTypeFromJson(data), dataJson: JSON.stringify(data) }; },
      }, { rules: { cardsPerPlayer: Number(needed), cardRange }, origin: 'https://admin.invalid' });
      const serialized = JSON.stringify(payload);
      if (payload.cards.length !== needed || new TextEncoder().encode(serialized).byteLength > 512_000) throw new Error('ADMIN_PVP_SUBMISSION_LIMIT');
      const usedIds = new Set(payload.cards.flatMap((card) => card.ref.kind === 'data_card' ? [card.ref.id] : []));
      const observed = candidates.filter((candidate) => usedIds.has(candidate.id));
      if (observed.length) {
        additional.push(`NOT EXISTS (SELECT 1 FROM json_each(?) selected LEFT JOIN data_cards d ON d.id=json_extract(selected.value,'$.id')
          WHERE d.id IS NULL OR CAST(d.is_public AS INTEGER)!=1 OR d.type!='character' OR d.review_status!='approved' OR d.deleted_at IS NOT NULL
          OR d.data IS NOT json_extract(selected.value,'$.data') OR d.updated_at IS NOT json_extract(selected.value,'$.updated_at')
          OR d.like_count IS NOT json_extract(selected.value,'$.like_count') OR d.usage_count IS NOT json_extract(selected.value,'$.usage_count') OR d.favorite_count IS NOT json_extract(selected.value,'$.favorite_count'))`);
        additionalBindings.push(JSON.stringify(observed));
      }
      additional.push('NOT EXISTS (SELECT 1 FROM pvp_room_submissions WHERE room_id=pvp_rooms.id AND user_id=?)', '(SELECT count(*) FROM pvp_room_submissions WHERE room_id=pvp_rooms.id)=?');
      additionalBindings.push(pending.pendingUserId, submissions.length);
      effects.push({ name: 'force-submission', sql: 'INSERT INTO pvp_room_submissions(room_id,user_id,submission_json,created_at,updated_at) SELECT ?,?,?,?,? WHERE {{admin_guard}}', bindings: [room.id, pending.pendingUserId, serialized, now, now], expectedChanges: 1 });
    }
  } else if (kind === 'force-choose') {
    additional.push("phase='choosing'", "status='open'");
    if (!round || round.status !== 'pending') additional.push('0=1');
    else {
      const choices = await adminAggregateRows<{ userId: number; updatedAt: string }>(db, 'SELECT user_id AS userId,updated_at AS updatedAt FROM pvp_round_choices WHERE round_id=? ORDER BY user_id LIMIT 7', [round.id]);
      const pending = computeLastPendingChooseAction({ nowMs: Date.now(), phaseFallbackAt: round.created_at, players: members, choices });
      if (!pending || !canForcePendingAction(pending, Date.now())) additional.push('0=1');
      else {
        const hands = await adminAggregateRows<{ hand_json: string }>(db, 'SELECT hand_json FROM pvp_room_hands WHERE room_id=? AND user_id=?', [room.id, pending.pendingUserId]);
        const hand = hands[0] ? parseAdminPvpRules(hands[0].hand_json) : null;
        const card = Array.isArray(hand?.cards) ? hand.cards.find((item) => item && typeof item === 'object' && item.kind === 'snapshot' && typeof item.id === 'string') as { id: string } | undefined : undefined;
        if (!card) throw new Error('ADMIN_PVP_PENDING_HAND_UNAVAILABLE');
        additional.push('EXISTS (SELECT 1 FROM pvp_room_hands WHERE room_id=pvp_rooms.id AND user_id=? AND hand_json=?)', 'NOT EXISTS (SELECT 1 FROM pvp_round_choices WHERE round_id=? AND user_id=?)', '(SELECT count(*) FROM pvp_round_choices WHERE round_id=?)=?');
        additionalBindings.push(pending.pendingUserId, hands[0].hand_json, round.id, pending.pendingUserId, round.id, choices.length);
        additional.push('EXISTS (SELECT 1 FROM pvp_room_card_snapshots WHERE room_id=pvp_rooms.id AND id=?)');
        additionalBindings.push(card.id);
        effects.push({ name: 'force-choice', sql: 'INSERT INTO pvp_round_choices(round_id,user_id,choice_ref_json,created_at,updated_at) SELECT ?,?,?,?,? WHERE {{admin_guard}}', bindings: [round.id, pending.pendingUserId, JSON.stringify({ kind: 'snapshot', id: card.id }), now, now], expectedChanges: 1 });
      }
    }
  } else if (kind === 'force-confirm') {
    additional.push("phase='reviewing'", "status='open'");
    const post = rawRules._postRound && typeof rawRules._postRound === 'object' && !Array.isArray(rawRules._postRound) ? rawRules._postRound as Record<string, unknown> : {};
    const confirmedUserIds = Array.isArray(post.confirmedUserIds) ? post.confirmedUserIds.filter((id): id is number => Number.isSafeInteger(id)) : [];
    const times = post.confirmedAtByUserId && typeof post.confirmedAtByUserId === 'object' && !Array.isArray(post.confirmedAtByUserId) ? Object.fromEntries(Object.entries(post.confirmedAtByUserId).filter(([, value]) => typeof value === 'string')) as Record<string, string> : {};
    const pending = computeLastPendingConfirmAction({ nowMs: Date.now(), phaseFallbackAt: room.last_activity_at ?? room.updated_at, postRoundCreatedAt: typeof post.createdAt === 'string' ? post.createdAt : null, players: members, confirmedUserIds, confirmedAtByUserId: times });
    if (!pending || !canForcePendingAction(pending, Date.now())) additional.push('0=1');
    else { rawRules._postRound = { ...post, confirmedUserIds: [...new Set([...confirmedUserIds, pending.pendingUserId])], confirmedAtByUserId: { ...times, [pending.pendingUserId]: now }, updatedAt: now }; rulesJson = JSON.stringify(rawRules); }
  }
  if (clearingRuntime) for (const table of runtimeTables) {
    // Large cleanup must go through a recoverable maintenance job, never an unbounded request.
    additional.push(`(SELECT count(*) FROM ${table} WHERE room_id=pvp_rooms.id)<=100`);
    effects.push({ name: `clear-${table.replaceAll('_', '-')}`, sql: `DELETE FROM ${table} WHERE room_id=? AND {{admin_guard}}`, bindings: [room.id] });
  }
  if (clearingEphemeral) {
    additional.push('(SELECT count(*) FROM pvp_room_chat_messages WHERE room_id=pvp_rooms.id)<=100', '(SELECT count(*) FROM pvp_round_choices WHERE round_id IN (SELECT id FROM pvp_rounds WHERE room_id=pvp_rooms.id))<=100');
    effects.push({ name: 'clear-chats', sql: 'DELETE FROM pvp_room_chat_messages WHERE room_id=? AND {{admin_guard}}', bindings: [room.id] },
      { name: 'clear-choices', sql: 'DELETE FROM pvp_round_choices WHERE round_id IN (SELECT id FROM pvp_rounds WHERE room_id=?) AND {{admin_guard}}', bindings: [room.id] });
  }
  return executeAdminOperation(db, { actorPrincipalId: context.principalId, requestId: context.requestId, authnContextSafeRef: context.authnContextSafeRef,
    capability: 'pvp-rooms.write', action: `pvp-rooms.${kind}`, targetType: 'pvp-rooms', targetId: room.id, reason: input.reason, idempotencyKey: input.idempotencyKey, expectedVersion: String(input.expectedVersion), payload: input }, {
    primary: { name: 'intervene-room', sql: `UPDATE pvp_rooms SET status=?,phase=?,current_match_id=?,rules_json=?,version=version+1,updated_at=?,last_activity_at=?
      WHERE id=? AND version=? AND rules_json=? AND current_match_id IS ? AND ${additional.join(' AND ')} AND {{admin_guard}}`,
      bindings: [nextStatus, nextPhase, nextMatch, rulesJson, now, now, room.id, input.expectedVersion, room.rules_json, room.current_match_id, ...additionalBindings] },
    effects, result: { roomId: room.id, action: kind, version: input.expectedVersion + 1, phase: nextPhase },
  });
}

export const ADMIN_ARENA_ACTIONS: AdminBusinessAction[] = [
  defineAction({ name: 'ratings.reset', label: '重置单队列评分（保留赛季极值和事件历史）', resource: 'ratings', capability: 'ratings.write', fields: fields([['id', '评分复合ID', 'text'], ['expectedVersion', '当前版本', 'text']]) },
    z.object(mutationInput).strict(), async (db, input) => {
      const key = z.tuple([z.enum(['data_card', 'preset']), z.string().min(1).max(128), z.enum(['strict', 'free'])]).parse(JSON.parse(input.id));
      const current = await snapshot(db, 'ratings', input.id, input.expectedVersion);
      return { targetId: input.id, plan: { primary: { name: 'reset-rating', sql: `UPDATE arena_ratings SET rating=?,games=0,wins=0,losses=0,draws=0,last_delta=NULL,last_applied_at=NULL,updated_at=?
        WHERE ${current.where} AND NOT EXISTS (SELECT 1 FROM arena_rating_events WHERE status='pending' AND queue=? AND ((a_entity_type=? AND a_entity_id=?) OR (b_entity_type=? AND b_entity_id=?))) AND {{admin_guard}}`,
        bindings: [INITIAL_RATING, new Date().toISOString(), ...current.bindings, key[2], key[0], key[1], key[0], key[1]] }, result: { entityType: key[0], entityId: key[1], queue: key[2], rating: INITIAL_RATING } } };
    }),
  ...(['close', 'restart', 'recover', 'clear-ephemeral', 'force-submit', 'force-choose', 'force-confirm'] as const).map((kind): AdminBusinessAction => ({
    name: `pvp-rooms.${kind}`, label: ({ close: '关闭房间', restart: '重开房间', recover: '恢复已终止的resolving', 'clear-ephemeral': '清理已关闭房间临时状态', 'force-submit': '代最后一人提交公库/预设卡（超时后）', 'force-choose': '代最后一人出牌（超时后）', 'force-confirm': '代最后一人确认（超时后）' })[kind],
    resource: 'pvp-rooms', capability: 'pvp-rooms.write', fields: fields([['id', '房间ID', 'text'], ['expectedVersion', '当前房间version', 'number'], ...(kind === 'close' ? [['cleanupMode', 'preserve / runtime / ephemeral', 'text', false] as [string, string, 'text', boolean]] : [])]),
    async execute(db, input, context) { return intervene(db, interventionInput.parse(input), context, kind); },
  })),
];
