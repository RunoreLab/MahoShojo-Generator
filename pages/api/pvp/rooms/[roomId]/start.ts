import {
  createPvpCardSnapshot,
  createPvpMatch,
  createPvpMatchPlayers,
  createPvpRound,
  generateUUID,
  getPvpCardSnapshotById,
  getPvpEligibleDataCard,
  getPvpEligibleScenarioDataCard,
  getRandomPublicCardExcluding,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  updatePvpMatch,
  updatePvpRoomMember,
  updatePvpRoomCas,
  upsertPvpRoomHand,
} from '@/lib/d1';
import { pickBotChoiceSnapshotId } from '@/lib/pvp/bot/choose';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { isPvpCombatantTypeAllowedByRange, normalizePvpRoomCardRange } from '@/lib/pvp/card-range';
import { inferPvpCombatantTypeFromJson, requiresPvpSubmissionPhase } from '@/lib/pvp/logic';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { loadPresetCard } from '@/lib/pvp/preset';
import { BUNDLED_PRESET_FILENAMES } from '@/lib/pvp/preset-bundled';
import { shuffleInPlace } from '@/lib/pvp/random';
import { getPvpFallbackDrawOrder } from '@/lib/pvp/drawSource';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { parsePvpScenarioSelection } from '@/lib/pvp/scenario';
import { compactPvpSeats } from '@/lib/pvp/seat-compaction';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpCardRef, PvpHandState, PvpSubmissionPayload, PvpSubmittedCard } from '@/lib/pvp/types';

export const runtime = 'edge';

const parseSubmission = (raw: string): PvpSubmissionPayload | null => {
  try {
    const parsed = JSON.parse(raw) as PvpSubmissionPayload;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
};

type StartBody = { expectedVersion?: number };

async function startHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<StartBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可开始对局' }, { status: 403 });
  if (room.status !== 'open') return json({ error: '房间已关闭' }, { status: 410 });

  const originalRulesJson = room.rules_json;
  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const internal = internalParsed.internal;
  const rules = internal.rules;
  const cardRange = normalizePvpRoomCardRange(rules);
  const bots = internal.bots;
  const requireSubmissions = requiresPvpSubmissionPhase(rules);
  const hostOnlyDeck = rules.submissionMode === 'hostOnly';
  const recordMatch = bots.length <= 0;
  const scenarioSelection = parsePvpScenarioSelection((internal.raw as any)?._scenario);
  if (rules.mode === 'scenario' && !scenarioSelection) {
    return json({ error: '当前为情景模式，但尚未选择情景', code: 'SCENARIO_MISSING' }, { status: 409 });
  }
  if (rules.mode === 'scenario' && scenarioSelection) {
    const row = await getPvpEligibleScenarioDataCard(scenarioSelection.id, auth.user.id);
    if (!row) {
      return json({ error: '所选情景已不可用（可能未通过审查/已被封禁/已删除），请重新选择情景', code: 'SCENARIO_NOT_ELIGIBLE' }, { status: 409 });
    }
    const expectedUpdatedAt = typeof scenarioSelection.updatedAt === 'string' ? scenarioSelection.updatedAt : null;
    const actualUpdatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
    if (expectedUpdatedAt && actualUpdatedAt && expectedUpdatedAt !== actualUpdatedAt) {
      return json({ error: '情景数据卡版本已变更，请重新选择情景后再开始对局', code: 'SCENARIO_VERSION_MISMATCH', expected: expectedUpdatedAt, actual: actualUpdatedAt }, { status: 409 });
    }
  }

  // 幂等：若已发牌则直接返回
  if (room.phase === 'choosing') return json({ success: true, alreadyStarted: true });

  // cardsPerPlayer=0：跳过提交阶段，允许 waiting 直接开始发牌
  const players = await getPvpRoomPlayers(roomId);
  const totalParticipants = players.length + bots.length;
  if (totalParticipants < 2) return json({ error: '至少需要 2 名参与者才能开始' }, { status: 409 });

  const earlyStart = totalParticipants < rules.participants;
  const originalParticipants = rules.participants;
  const desiredParticipants = earlyStart ? totalParticipants : rules.participants;

  const seatCompaction = earlyStart
    ? compactPvpSeats({
      humans: players.map((p) => ({ userId: p.user_id, seat: p.seat ?? -1 })),
      bots: bots.map((b) => ({ botId: b.id, seat: b.seat })),
    })
    : null;
  if (seatCompaction && 'error' in seatCompaction) return json({ error: seatCompaction.error }, { status: 500 });

  const newSeatByHumanUserId = new Map<number, number>();
  const newSeatByBotId = new Map<string, number>();
  if (seatCompaction && !('error' in seatCompaction)) {
    for (const h of seatCompaction.humans) newSeatByHumanUserId.set(h.userId, h.newSeat);
    for (const b of seatCompaction.bots) newSeatByBotId.set(b.botId, b.newSeat);
  }

  // cardsPerPlayer>0 且仍处于 waiting：允许房主“未满员提前开局”，将人数缩到当前人数并推进到 submitting
  if (requireSubmissions && room.phase === 'waiting') {
    if (!earlyStart) return json({ error: '当前阶段不允许开始对局', code: 'PHASE_FORBIDDEN' }, { status: 409 });

    // 清理 Bot 运行态（手牌/选择），避免残留影响后续流程
    internal.bots = internal.bots.map((b) => ({ ...b, hand: undefined, choicesByRoundId: undefined }));
    internal.rules.participants = desiredParticipants;
    internal.bots = internal.bots.map((b) => ({ ...b, seat: newSeatByBotId.get(b.id) ?? b.seat }));
    const nextRulesJson = stringifyPvpRoomInternalState(internal);

    const now = new Date().toISOString();
    const advancedOk = await updatePvpRoomCas(roomId, expectedVersion, {
      phase: 'submitting',
      rules_json: nextRulesJson,
      last_activity_at: now,
    });
    if (!advancedOk) return json({ error: '开始失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });
    const advancedVersion = expectedVersion + 1;

    // 提前开局时同步整理玩家 seat，保证 seat < participants（否则后续规则保存/座位分配会异常）
    if (seatCompaction && !('error' in seatCompaction)) {
      const seatUpdateFailures: Array<{ userId: number; from: number; to: number }> = [];
      const seatUpdated: Array<{ userId: number; originalSeat: number }> = [];

      for (const h of seatCompaction.humans) {
        if (h.seat === h.newSeat) continue;
        const ok = await updatePvpRoomMember({ roomId, userId: h.userId, role: 'player', seat: h.newSeat });
        if (!ok) {
          seatUpdateFailures.push({ userId: h.userId, from: h.seat, to: h.newSeat });
          break;
        }
        seatUpdated.push({ userId: h.userId, originalSeat: h.seat });
      }

      if (seatUpdateFailures.length > 0) {
        for (const u of seatUpdated) {
          await updatePvpRoomMember({ roomId, userId: u.userId, role: 'player', seat: u.originalSeat });
        }
        await updatePvpRoomCas(roomId, advancedVersion, {
          phase: 'waiting',
          rules_json: originalRulesJson,
          last_activity_at: new Date().toISOString(),
        });
        return json({ error: '开始失败：座位整理失败，请稍后重试', code: 'SEAT_UPDATE_FAILED' }, { status: 409 });
      }
    }

    return json({
      success: true,
      advanced: true,
      nextPhase: 'submitting',
      nextVersion: advancedVersion,
      earlyStart: { from: originalParticipants, to: desiredParticipants },
    });
  }

  const allowedToStart =
    requireSubmissions
      ? room.phase === 'submitting'
      : (room.phase === 'waiting' || room.phase === 'submitting');
  if (!allowedToStart) {
    return json({ error: '当前阶段不允许开始对局', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const sortedPlayers = [...players].sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
  if (sortedPlayers.some((p) => typeof p.seat !== 'number')) return json({ error: '房间座位异常' }, { status: 500 });
  if (bots.some((b) => !Number.isFinite(b.seat))) return json({ error: '机器人座位异常' }, { status: 500 });

  const usedSeats = new Set<number>();
  for (const p of sortedPlayers) usedSeats.add(seatCompaction ? (newSeatByHumanUserId.get(p.user_id) ?? (p.seat as number)) : (p.seat as number));
  for (const b of bots) {
    const effectiveSeat = seatCompaction ? (newSeatByBotId.get(b.id) ?? b.seat) : b.seat;
    if (usedSeats.has(effectiveSeat)) return json({ error: '座位冲突（机器人与玩家座位重复）', code: 'SEAT_CONFLICT' }, { status: 500 });
    usedSeats.add(effectiveSeat);
  }

  const participants = [
    ...sortedPlayers.map((p) => ({
      kind: 'human' as const,
      seat: seatCompaction ? (newSeatByHumanUserId.get(p.user_id) ?? (p.seat as number)) : (p.seat as number),
      userId: p.user_id,
      username: p.username ?? null,
      prefix: p.prefix ?? null,
      joinedAt: p.joined_at,
    })),
    ...bots.map((b) => ({
      kind: 'bot' as const,
      seat: seatCompaction ? (newSeatByBotId.get(b.id) ?? b.seat) : b.seat,
      botId: b.id,
      name: b.name,
      strategyId: b.strategyId,
    })),
  ].sort((a, b) => a.seat - b.seat);
  if (participants.length !== desiredParticipants) return json({ error: '房间参与者数量与规则不一致' }, { status: 500 });

  const submissions = requireSubmissions ? await getPvpRoomSubmissions(roomId) : [];
  const submissionMap = new Map<number, PvpSubmissionPayload>();
  if (requireSubmissions) {
    for (const row of submissions) {
      const parsed = parseSubmission(row.submission_json);
      if (!parsed) return json({ error: '提交数据损坏，请重新提交' }, { status: 409 });
      submissionMap.set(row.user_id, parsed);
    }

    if (hostOnlyDeck) {
      const hostSub = submissionMap.get(room.host_user_id);
      if (!hostSub) return json({ error: '房主尚未提交牌堆' }, { status: 409 });
      if (!Array.isArray(hostSub.cards) || hostSub.cards.length <= 0) return json({ error: '房主提交的牌堆为空' }, { status: 409 });
    } else {
      for (const p of sortedPlayers) {
        const sub = submissionMap.get(p.user_id);
        if (!sub) return json({ error: '仍有玩家未提交卡组' }, { status: 409 });
        if (sub.cards.length !== rules.cardsPerPlayer) return json({ error: '提交数量与房间规则不一致，请重新提交' }, { status: 409 });
      }
      for (const b of bots) {
        if (!b.submission || !Array.isArray(b.submission.cards) || b.submission.cards.length !== rules.cardsPerPlayer) {
          return json({ error: '机器人提交异常，请移除机器人后重新添加', code: 'BOT_SUBMISSION_INVALID' }, { status: 409 });
        }
      }
    }
  }

  // 防御：若 submitting 阶段仍存在手牌，说明上一次对局清理不完整
  const existingHandsBeforeStart = await getPvpRoomHands(roomId);
  if (existingHandsBeforeStart.length > 0) {
    return json({ error: '检测到残留手牌数据，请房主先重开房间再开始', code: 'RUNTIME_STATE_DIRTY' }, { status: 409 });
  }

  // 清理 Bot 运行态（手牌/选择），避免上一局残留影响
  internal.bots = internal.bots.map((b) => ({ ...b, hand: undefined, choicesByRoundId: undefined }));
  if (earlyStart) {
    internal.rules.participants = desiredParticipants;
    internal.bots = internal.bots.map((b) => ({
      ...b,
      seat: newSeatByBotId.get(b.id) ?? b.seat,
    }));
  }
  const rulesJsonForStart = earlyStart ? stringifyPvpRoomInternalState(internal) : originalRulesJson;

  const matchId = generateUUID();
  const matchStartedAt = new Date().toISOString();

  const casToDealing = await updatePvpRoomCas(roomId, expectedVersion, {
    phase: 'dealing',
    current_match_id: matchId,
    last_activity_at: matchStartedAt,
    ...(earlyStart ? { rules_json: rulesJsonForStart } : {}),
  });
  if (!casToDealing) return json({ error: '开始失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });
  const dealingVersion = expectedVersion + 1;

  const rollbackPhase = requireSubmissions ? ('submitting' as const) : ('waiting' as const);
  const rollbackRulesJson = originalRulesJson;
  const abortAndRollback = async (reason: string, extra?: Record<string, unknown>): Promise<boolean> => {
    const now = new Date().toISOString();

    // best-effort：标记对战为 aborted（若对战记录尚未创建则该更新会失败，但不影响回滚）
    if (recordMatch) {
      await updatePvpMatch(matchId, {
        status: 'aborted',
        endedAt: now,
        winnerUserId: null,
        resultJson: JSON.stringify({ reason, ...(extra ?? {}) }),
      });
    }

    const patch = {
      phase: rollbackPhase,
      current_match_id: null,
      last_activity_at: now,
      ...(earlyStart ? { rules_json: rollbackRulesJson } : {}),
    };

    const ok = await updatePvpRoomCas(roomId, dealingVersion, patch);
    if (ok) return true;

    // 回滚 CAS 失败时，尝试刷新版本并在“仍处于 dealing 且 matchId 未变”的条件下再试一次
    const refreshed = await getPvpRoomById(roomId);
    if (!refreshed) return false;
    if (refreshed.phase !== 'dealing') return false;
    if (refreshed.current_match_id !== matchId) return false;
    return await updatePvpRoomCas(roomId, refreshed.version, patch);
  };

  if (seatCompaction && !('error' in seatCompaction)) {
    const seatUpdateFailures: Array<{ userId: number; from: number; to: number }> = [];
    const seatUpdated: Array<{ userId: number; originalSeat: number }> = [];

    for (const h of seatCompaction.humans) {
      if (h.seat === h.newSeat) continue;
      const ok = await updatePvpRoomMember({ roomId, userId: h.userId, role: 'player', seat: h.newSeat });
      if (!ok) {
        seatUpdateFailures.push({ userId: h.userId, from: h.seat, to: h.newSeat });
        break;
      }
      seatUpdated.push({ userId: h.userId, originalSeat: h.seat });
    }

    if (seatUpdateFailures.length > 0) {
      // best-effort：回滚已更新的 seat
      for (const u of seatUpdated) {
        await updatePvpRoomMember({ roomId, userId: u.userId, role: 'player', seat: u.originalSeat });
      }

      const rolledBack = await abortAndRollback('seat-update-failed', { failures: seatUpdateFailures });
      if (!rolledBack) {
        return json({ error: '开始失败：座位整理失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
      }
      return json({ error: '开始失败：座位整理失败，请稍后重试', code: 'SEAT_UPDATE_FAILED' }, { status: 409 });
    }
  }

  if (recordMatch) {
    const matchOk = await createPvpMatch({
      id: matchId,
      roomId,
      rulesJson: rulesJsonForStart,
      participants: rules.participants,
      startedAt: matchStartedAt,
    });
    if (!matchOk) {
      const rolledBack = await abortAndRollback('match-create-failed');
      if (!rolledBack) {
        return json({ error: '创建对战记录失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
      }
      return json({ error: '创建对战记录失败' }, { status: 500 });
    }

    const matchPlayersOk = await createPvpMatchPlayers(
      matchId,
      sortedPlayers.map((p) => ({
        userId: p.user_id,
        seat: seatCompaction ? (newSeatByHumanUserId.get(p.user_id) ?? (p.seat ?? 0)) : (p.seat ?? 0),
        username: p.username ?? null,
        userPrefix: p.prefix ?? null,
        joinedAt: p.joined_at,
      }))
    );
    if (!matchPlayersOk) {
      const rolledBack = await abortAndRollback('match-players-create-failed');
      if (!rolledBack) {
        return json({ error: '创建对战参与者快照失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
      }
      return json({ error: '创建对战参与者快照失败' }, { status: 500 });
    }
  }

  const submittedDataCardIds = new Set<string>();
  const submittedPresetFilenames = new Set<string>();
  if (requireSubmissions) {
    if (hostOnlyDeck) {
      const host = submissionMap.get(room.host_user_id);
      for (const c of host?.cards ?? []) {
        if (c?.ref?.kind === 'data_card' && typeof (c.ref as any)?.id === 'string') {
          const id = String((c.ref as any).id).trim();
          if (id) submittedDataCardIds.add(id);
        }
        if (c?.ref?.kind === 'preset' && typeof (c.ref as any)?.filename === 'string') {
          const filename = String((c.ref as any).filename).trim();
          if (filename) submittedPresetFilenames.add(filename);
        }
      }
    } else {
      for (const row of submissions) {
        const parsed = parseSubmission(row.submission_json);
        if (!parsed) continue;
        for (const c of parsed.cards) {
          if (c?.ref?.kind === 'data_card' && typeof (c.ref as any)?.id === 'string') {
            const id = String((c.ref as any).id).trim();
            if (id) submittedDataCardIds.add(id);
          }
          if (c?.ref?.kind === 'preset' && typeof (c.ref as any)?.filename === 'string') {
            const filename = String((c.ref as any).filename).trim();
            if (filename) submittedPresetFilenames.add(filename);
          }
        }
      }
      for (const b of bots) {
        for (const c of b.submission?.cards ?? []) {
          if (c?.ref?.kind === 'data_card' && typeof (c.ref as any)?.id === 'string') {
            const id = String((c.ref as any).id).trim();
            if (id) submittedDataCardIds.add(id);
          }
          if (c?.ref?.kind === 'preset' && typeof (c.ref as any)?.filename === 'string') {
            const filename = String((c.ref as any).filename).trim();
            if (filename) submittedPresetFilenames.add(filename);
          }
        }
      }
    }
  }

  const publicDrawnDataCardIds = new Set<string>();
  const presetDrawnFilenames = new Set<string>();

  const buildPresetFilenameVariants = (filename: string): string[] => {
    const raw = typeof filename === 'string' ? filename.trim() : '';
    if (!raw) return [];
    const lower = raw.toLowerCase();
    if (lower.endsWith('.json')) return [raw, raw.slice(0, -5)];
    return [raw, `${raw}.json`];
  };
  const isPresetExcluded = (candidate: string, exclude: Set<string>): boolean => {
    const variants = buildPresetFilenameVariants(candidate);
    return variants.some((v) => exclude.has(v));
  };

  const drawPublicSnapshot = async (ownerUserId: number): Promise<{ kind: 'snapshot'; id: string } | null> => {
    const statsOptions = {
      minLikeCount: cardRange.minLikeCount,
      maxLikeCount: cardRange.maxLikeCount,
      minUsageCount: cardRange.minUsageCount,
      maxUsageCount: cardRange.maxUsageCount,
      minFavoriteCount: cardRange.minFavoriteCount,
      maxFavoriteCount: cardRange.maxFavoriteCount,
    };

    for (let attempt = 0; attempt < 25; attempt++) {
      const excludeIds = [...new Set([...submittedDataCardIds, ...publicDrawnDataCardIds])];
      const row = await getRandomPublicCardExcluding('character', excludeIds, statsOptions);
      if (!row || typeof row.id !== 'string' || !row.id.trim()) return null;
      const dataCardId = String(row.id).trim();
      if (submittedDataCardIds.has(dataCardId) || publicDrawnDataCardIds.has(dataCardId)) continue;

      let parsed: any;
      try {
        parsed = JSON.parse(String(row.data ?? '{}'));
      } catch {
        publicDrawnDataCardIds.add(dataCardId);
        continue;
      }

      const combatantType = inferPvpCombatantTypeFromJson(parsed);
      if (!isPvpCombatantTypeAllowedByRange(combatantType, cardRange)) {
        publicDrawnDataCardIds.add(dataCardId);
        continue;
      }

      const snapshotId = await createPvpCardSnapshot({
        roomId,
        ownerUserId,
        refJson: JSON.stringify({
          kind: 'data_card',
          id: dataCardId,
          updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
          drawnFromPublic: true,
          sourceIsPublic: true,
          sourceAuthor: typeof row.username === 'string' ? row.username : null,
        }),
        cardType: combatantType,
        name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '公开库卡牌',
        dataJson: JSON.stringify(parsed),
        sourceUpdatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
      });
      if (!snapshotId) {
        publicDrawnDataCardIds.add(dataCardId);
        continue;
      }

      publicDrawnDataCardIds.add(dataCardId);
      return { kind: 'snapshot', id: snapshotId };
    }

    return null;
  };

  const origin = getRequestOrigin(req);

  const drawPresetSnapshot = async (ownerUserId: number): Promise<{ kind: 'snapshot'; id: string } | null> => {
    const exclude = new Set<string>();
    for (const f of submittedPresetFilenames) for (const v of buildPresetFilenameVariants(f)) exclude.add(v);
    for (const f of presetDrawnFilenames) for (const v of buildPresetFilenameVariants(f)) exclude.add(v);
    const excludePreset = (filename: string) => {
      for (const v of buildPresetFilenameVariants(filename)) exclude.add(v);
    };

    const allowMagicalGirl = cardRange.allowedCombatantTypes.includes('magical-girl');
    const allowCanshou = cardRange.allowedCombatantTypes.includes('canshou');

    for (let attempt = 0; attempt < 25; attempt++) {
      const candidates = BUNDLED_PRESET_FILENAMES
        .filter((f) => !isPresetExcluded(f, exclude))
        .filter((f) => {
          const normalized = typeof f === 'string' ? f.trim() : '';
          const upper = normalized.toUpperCase();
          if (!allowMagicalGirl && upper.startsWith('M')) return false;
          if (!allowCanshou && upper.startsWith('C')) return false;
          return true;
        });

      if (candidates.length <= 0) return null;

      const picked = candidates[Math.floor(Math.random() * candidates.length)] ?? null;
      if (!picked) return null;

      let preset: Awaited<ReturnType<typeof loadPresetCard>>;
      try {
        preset = await loadPresetCard(origin, picked);
      } catch {
        excludePreset(picked);
        continue;
      }

      if (!isPvpCombatantTypeAllowedByRange(preset.type, cardRange)) {
        excludePreset(picked);
        continue;
      }

      const snapshotId = await createPvpCardSnapshot({
        roomId,
        ownerUserId,
        refJson: JSON.stringify({
          kind: 'preset',
          filename: picked,
          drawnFromPreset: true,
          sourceIsPublic: true,
          sourceAuthor: null,
        }),
        cardType: preset.type,
        name: preset.name || '预设卡牌',
        dataJson: preset.dataJson,
        sourceUpdatedAt: null,
      });
      if (!snapshotId) {
        excludePreset(picked);
        continue;
      }

      presetDrawnFilenames.add(picked);
      return { kind: 'snapshot', id: snapshotId };
    }

    return null;
  };

  const drawFallbackSnapshot = async (ownerUserId: number): Promise<{ kind: 'snapshot'; id: string } | null> => {
    for (const kind of getPvpFallbackDrawOrder(rules.drawSource)) {
      const snap = kind === 'preset' ? await drawPresetSnapshot(ownerUserId) : await drawPublicSnapshot(ownerUserId);
      if (snap) return snap;
    }
    return null;
  };

  const fillHandWithFallback = async (ownerUserId: number, hand: PvpHandState, targetSize: number): Promise<PvpHandState> => {
    const cards = [...(Array.isArray(hand.cards) ? hand.cards : [])];
    while (cards.length < targetSize) {
      const next = await drawFallbackSnapshot(ownerUserId);
      if (!next) break;
      cards.push(next);
    }
    return { ...hand, cards };
  };

  if (!requireSubmissions) {
    const botById = new Map(internal.bots.map((b) => [b.id, b]));

    const desired = Math.max(1, Math.floor(rules.dealWhenEmpty));
    for (const participant of participants) {
      const ownerUserId = participant.kind === 'human' ? participant.userId : auth.user.id;
      const baseHand: PvpHandState = { cards: [], discarded: [], drawPile: [] };
      const filled = await fillHandWithFallback(ownerUserId, baseHand, desired);
      if (!Array.isArray(filled.cards) || filled.cards.length < desired) {
        const rolledBack = await abortAndRollback('initial-deal-insufficient', { desired, got: filled.cards?.length ?? 0 });
        if (!rolledBack) {
          return json({ error: '发牌失败：可用卡牌不足，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
        }
        return json({ error: '发牌失败：可用卡牌不足，请调整抽取来源或规则后重试', code: 'INITIAL_DEAL_FAILED' }, { status: 409 });
      }

      if (participant.kind === 'human') {
        const ok = await upsertPvpRoomHand(roomId, participant.userId, JSON.stringify(filled));
        if (!ok) {
          const rolledBack = await abortAndRollback('hand-write-failed', { userId: participant.userId });
          if (!rolledBack) {
            return json({ error: '写入手牌失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
          }
          return json({ error: '写入手牌失败' }, { status: 500 });
        }
        continue;
      }

      const bot = botById.get(participant.botId);
      if (bot) bot.hand = filled;
    }

    (internal.raw as any)._drawPile = [];
    (internal.raw as any)._usedPile = [];
    (internal.raw as any)._submittedDataCardIds = [];
    (internal.raw as any)._submittedPresetFilenames = [];
    (internal.raw as any)._publicDrawnCardIds = [...publicDrawnDataCardIds];
    (internal.raw as any)._presetDrawnFilenames = [...presetDrawnFilenames];

    const roundId = await createPvpRound({
      roomId,
      matchId,
      roundIndex: 1,
      status: 'pending',
      publicSnapshotJson: JSON.stringify({
        dealPerPlayer: rules.dealPerPlayer,
        cardsPerPlayer: rules.cardsPerPlayer,
        dealWhenEmpty: rules.dealWhenEmpty,
        drawSource: rules.drawSource,
        recycleUsedCards: rules.recycleUsedCards,
        dedupe: rules.dedupe,
        hiddenCount: 0,
        mode: rules.mode,
        bestOf: rules.bestOf,
        showAllSubmissions: rules.showAllSubmissions,
        shuffleDecks: rules.shuffleDecks,
      }),
    });
    if (!roundId) {
      const rolledBack = await abortAndRollback('round-create-failed');
      if (!rolledBack) {
        return json({ error: '创建回合失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
      }
      return json({ error: '创建回合失败' }, { status: 500 });
    }

    // Bot 自动出牌：为本回合预先选择（失败则不阻塞开局）
    try {
      for (const b of internal.bots) {
        if (!b.hand?.cards?.length) continue;
        const snapshotIds = b.hand.cards.map((c: any) => (c && c.kind === 'snapshot' ? c.id : null)).filter(Boolean) as string[];
        const snapshots = [];
        for (const id of snapshotIds) {
          const snap = await getPvpCardSnapshotById(id);
          if (snap) snapshots.push(snap);
        }
        const picked = await pickBotChoiceSnapshotId({
          bot: { strategyId: b.strategyId },
          snapshots: snapshots.map((s) => ({ id: s.id, name: s.name, data_json: s.data_json, ref_json: s.ref_json })),
        });
        if (picked) {
          b.choicesByRoundId = { ...(b.choicesByRoundId ?? {}), [roundId]: picked };
        }
      }
    } catch {
      // ignore
    }

    const casToChoosing = await updatePvpRoomCas(roomId, dealingVersion, {
      phase: 'choosing',
      rules_json: stringifyPvpRoomInternalState(internal),
      last_activity_at: new Date().toISOString(),
    });
    if (!casToChoosing) {
      return json({ success: true, roundId, warning: '发牌完成，但房间状态更新失败，请刷新' });
    }

    return json({ success: true, roundId, nextVersion: dealingVersion + 1 });
  }

  const initialHandsBySeat: Record<string, string[]> = {};

  if (rules.shuffleDecks !== true && !hostOnlyDeck) {
    const botById = new Map(internal.bots.map((b) => [b.id, b]));

    const hands: PvpHandState[] = [];
    const drawPile: Array<{ kind: 'snapshot'; id: string }> = [];

    for (const participant of participants) {
      const submittedBy =
        participant.kind === 'human'
          ? { kind: 'human' as const, userId: participant.userId, username: participant.username ?? null }
          : { kind: 'bot' as const, name: participant.name };

      const eligibilityUserId = participant.kind === 'human' ? participant.userId : auth.user.id;
      const submissionCards =
        participant.kind === 'human'
          ? (submissionMap.get(participant.userId)?.cards ?? [])
          : (botById.get(participant.botId)?.submission?.cards ?? []);
      const snapshotRefs: Array<{ kind: 'snapshot'; id: string }> = [];
      for (const card of submissionCards) {
        if (card.ref.kind === 'data_card') {
          const latest = await getPvpEligibleDataCard(card.ref.id, eligibilityUserId);
          if (!latest) {
            const rolledBack = await abortAndRollback('card-not-eligible', { cardId: card.ref.id });
            if (!rolledBack) {
              return json({ error: '存在不可用的数据卡，请重新提交（且回滚失败，请房主点击“重开房间”恢复）', code: 'ROLLBACK_FAILED' }, { status: 409 });
            }
            return json({ error: '存在不可用的数据卡，请重新提交', code: 'CARD_NOT_ELIGIBLE' }, { status: 409 });
          }
          const currentUpdatedAt = typeof latest.updated_at === 'string' ? latest.updated_at : null;
          if (card.ref.updatedAt && currentUpdatedAt && card.ref.updatedAt !== currentUpdatedAt) {
            const rolledBack = await abortAndRollback('card-version-mismatch', { cardId: card.ref.id });
            if (!rolledBack) {
              return json({ error: '数据卡版本已变更，请重新提交（且回滚失败，请房主点击“重开房间”恢复）', code: 'ROLLBACK_FAILED' }, { status: 409 });
            }
            return json({ error: '数据卡版本已变更，请重新提交', code: 'CARD_VERSION_MISMATCH', cardId: card.ref.id }, { status: 409 });
          }
        }

        const snapshotId = await createPvpCardSnapshot({
          roomId,
          ownerUserId: eligibilityUserId,
          refJson: JSON.stringify({
            ...card.ref,
            ...(submittedBy.kind === 'human'
              ? { submittedByUserId: submittedBy.userId, submittedByUsername: submittedBy.username }
              : { submittedByBot: true, submittedByBotName: submittedBy.name }),
          }),
          cardType: card.type,
          name: card.name,
          dataJson: card.dataJson,
          sourceUpdatedAt: card.ref.kind === 'data_card' ? card.ref.updatedAt : null,
        });
        if (!snapshotId) {
          const rolledBack = await abortAndRollback('snapshot-create-failed');
          if (!rolledBack) {
            return json({ error: '生成快照失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
          }
          return json({ error: '生成快照失败' }, { status: 500 });
        }
        snapshotRefs.push({ kind: 'snapshot', id: snapshotId });
      }

      const dealt = snapshotRefs.slice(0, rules.dealPerPlayer);
      const rest = snapshotRefs.slice(rules.dealPerPlayer);
      drawPile.push(...rest);

      const baseHand: PvpHandState = { cards: dealt, discarded: [], drawPile: [] };
      const filled =
        participant.kind === 'human'
          ? await fillHandWithFallback(participant.userId, baseHand, rules.dealPerPlayer)
          : await fillHandWithFallback(auth.user.id, baseHand, rules.dealPerPlayer);
      initialHandsBySeat[String(participant.seat)] = (Array.isArray(filled.cards) ? filled.cards : [])
        .map((c: any) => (c && typeof c === 'object' && c.kind === 'snapshot' && typeof c.id === 'string' ? c.id : null))
        .filter(Boolean) as string[];
      hands.push(filled);
    }

    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i]!;
      const hand = hands[i]!;
      if (participant.kind === 'human') {
        const ok = await upsertPvpRoomHand(roomId, participant.userId, JSON.stringify(hand));
        if (!ok) {
          const rolledBack = await abortAndRollback('hand-write-failed', { userId: participant.userId });
          if (!rolledBack) {
            return json({ error: '写入手牌失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
          }
          return json({ error: '写入手牌失败' }, { status: 500 });
        }
        continue;
      }

      const bot = botById.get(participant.botId);
      if (bot) bot.hand = hand;
    }

    (internal.raw as any)._drawPile = drawPile;
    (internal.raw as any)._usedPile = [];
    (internal.raw as any)._initialHandsMatchId = matchId;
    (internal.raw as any)._initialHandsBySeat = initialHandsBySeat;
    (internal.raw as any)._submittedDataCardIds = [...submittedDataCardIds];
    (internal.raw as any)._submittedPresetFilenames = [...submittedPresetFilenames];
    (internal.raw as any)._publicDrawnCardIds = [...publicDrawnDataCardIds];
    (internal.raw as any)._presetDrawnFilenames = [...presetDrawnFilenames];

    const roundId = await createPvpRound({
      roomId,
      matchId,
      roundIndex: 1,
      status: 'pending',
      publicSnapshotJson: JSON.stringify({
        dealPerPlayer: rules.dealPerPlayer,
        cardsPerPlayer: rules.cardsPerPlayer,
        dealWhenEmpty: rules.dealWhenEmpty,
        drawSource: rules.drawSource,
        recycleUsedCards: rules.recycleUsedCards,
        dedupe: rules.dedupe,
        hiddenCount: drawPile.length,
        mode: rules.mode,
        bestOf: rules.bestOf,
        showAllSubmissions: rules.showAllSubmissions,
        shuffleDecks: rules.shuffleDecks,
      }),
    });
    if (!roundId) {
      const rolledBack = await abortAndRollback('round-create-failed');
      if (!rolledBack) {
        return json({ error: '创建回合失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
      }
      return json({ error: '创建回合失败' }, { status: 500 });
    }

    // Bot 自动出牌：为本回合预先选择（失败则不阻塞开局）
    try {
      for (const b of internal.bots) {
        if (!b.hand?.cards?.length) continue;
        const snapshotIds = b.hand.cards.map((c: any) => (c && c.kind === 'snapshot' ? c.id : null)).filter(Boolean) as string[];
        const snapshots = [];
        for (const id of snapshotIds) {
          const snap = await getPvpCardSnapshotById(id);
          if (snap) snapshots.push(snap);
        }
        const picked = await pickBotChoiceSnapshotId({
          bot: { strategyId: b.strategyId },
          snapshots: snapshots.map((s) => ({ id: s.id, name: s.name, data_json: s.data_json, ref_json: s.ref_json })),
        });
        if (picked) {
          b.choicesByRoundId = { ...(b.choicesByRoundId ?? {}), [roundId]: picked };
        }
      }
    } catch {
      // ignore
    }

    const casToChoosing = await updatePvpRoomCas(roomId, dealingVersion, {
      phase: 'choosing',
      rules_json: stringifyPvpRoomInternalState(internal),
      last_activity_at: new Date().toISOString(),
    });
    if (!casToChoosing) {
      return json({ success: true, roundId, warning: '发牌完成，但房间状态更新失败，请刷新' });
    }

    return json({ success: true, roundId, nextVersion: dealingVersion + 1 });
  }

  // 合并提交卡，按规则去重
  const allSubmitted: Array<{
    eligibilityUserId: number;
    submittedBy: { kind: 'human'; userId: number; username: string | null } | { kind: 'bot'; name: string };
    card: PvpSubmittedCard;
  }> = [];

  if (hostOnlyDeck) {
    const hostId = room.host_user_id;
    const hostPlayer = sortedPlayers.find((p) => p.user_id === hostId) ?? null;
    const hostUsername = hostPlayer ? (hostPlayer.username ?? null) : null;
    const sub = submissionMap.get(hostId);
    (sub?.cards ?? []).forEach((card) =>
      allSubmitted.push({
        eligibilityUserId: hostId,
        submittedBy: { kind: 'human', userId: hostId, username: hostUsername },
        card,
      })
    );
  } else {
    for (const p of sortedPlayers) {
      const sub = submissionMap.get(p.user_id)!;
      sub.cards.forEach((card) =>
        allSubmitted.push({
          eligibilityUserId: p.user_id,
          submittedBy: { kind: 'human', userId: p.user_id, username: p.username ?? null },
          card,
        })
      );
    }
    for (const b of bots) {
      b.submission.cards.forEach((card) =>
        allSubmitted.push({
          eligibilityUserId: auth.user.id, // Bot 仅提交公开/预设，任意用户都可读；这里用房主 id 走统一校验
          submittedBy: { kind: 'bot', name: b.name },
          card,
        })
      );
    }
  }

  const buildKey = (ref: PvpCardRef): string =>
    ref.kind === 'data_card' ? `data_card:${ref.id}` : ref.kind === 'preset' ? `preset:${ref.filename}` : `snapshot:${ref.id}`;

  const deckCards: Array<{
    eligibilityUserId: number;
    submittedBy: { kind: 'human'; userId: number; username: string | null } | { kind: 'bot'; name: string };
    card: PvpSubmittedCard;
  }> = (() => {
    if (!rules.dedupe) return allSubmitted;
    const seen = new Set<string>();
    const out: Array<{
      eligibilityUserId: number;
      submittedBy: { kind: 'human'; userId: number; username: string | null } | { kind: 'bot'; name: string };
      card: PvpSubmittedCard;
    }> = [];
    for (const item of allSubmitted) {
      const key = buildKey(item.card.ref);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  })();

  // 再校验 data_card 版本与可用性，并生成快照
  const snapshotDeck: Array<{ kind: 'snapshot'; id: string }> = [];
  for (const { eligibilityUserId, submittedBy, card } of deckCards) {
    if (card.ref.kind === 'data_card') {
      const latest = await getPvpEligibleDataCard(card.ref.id, eligibilityUserId);
      if (!latest) {
        const rolledBack = await abortAndRollback('card-not-eligible', { cardId: card.ref.id });
        if (!rolledBack) {
          return json({ error: '存在不可用的数据卡，请重新提交（且回滚失败，请房主点击“重开房间”恢复）', code: 'ROLLBACK_FAILED' }, { status: 409 });
        }
        return json({ error: '存在不可用的数据卡，请重新提交', code: 'CARD_NOT_ELIGIBLE' }, { status: 409 });
      }
      const currentUpdatedAt = typeof latest.updated_at === 'string' ? latest.updated_at : null;
      if (card.ref.updatedAt && currentUpdatedAt && card.ref.updatedAt !== currentUpdatedAt) {
        const rolledBack = await abortAndRollback('card-version-mismatch', { cardId: card.ref.id });
        if (!rolledBack) {
          return json({ error: '数据卡版本已变更，请重新提交（且回滚失败，请房主点击“重开房间”恢复）', code: 'ROLLBACK_FAILED' }, { status: 409 });
        }
        return json({ error: '数据卡版本已变更，请重新提交', code: 'CARD_VERSION_MISMATCH', cardId: card.ref.id }, { status: 409 });
      }
    }

    const snapshotId = await createPvpCardSnapshot({
      roomId,
      ownerUserId: eligibilityUserId,
      refJson: JSON.stringify({
        ...card.ref,
        ...(submittedBy.kind === 'human'
          ? { submittedByUserId: submittedBy.userId, submittedByUsername: submittedBy.username }
          : { submittedByBot: true, submittedByBotName: submittedBy.name }),
      }),
      cardType: card.type,
      name: card.name,
      dataJson: card.dataJson,
      sourceUpdatedAt: card.ref.kind === 'data_card' ? card.ref.updatedAt : null,
    });
    if (!snapshotId) {
      const rolledBack = await abortAndRollback('snapshot-create-failed');
      if (!rolledBack) {
        return json({ error: '生成快照失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
      }
      return json({ error: '生成快照失败' }, { status: 500 });
    }
    snapshotDeck.push({ kind: 'snapshot', id: snapshotId });
  }

  shuffleInPlace(snapshotDeck);
  const hands: PvpHandState[] = Array.from({ length: participants.length }, () => ({
    cards: [],
    discarded: [],
    drawPile: [],
  }));
  const desired = Math.max(1, Math.floor(rules.dealPerPlayer));
  const totalNeeded = participants.length * desired;
  const totalDealt = Math.min(snapshotDeck.length, totalNeeded);
  for (let i = 0; i < totalDealt; i++) {
    const card = snapshotDeck[i]!;
    hands[i % participants.length]!.cards.push(card);
  }
  const drawPile = snapshotDeck.slice(totalDealt);
  const hiddenCount = drawPile.length

  const botById = new Map(internal.bots.map((b) => [b.id, b]));
  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i]!;
    const baseHand = hands[i]!;
    const filled =
      participant.kind === 'human'
        ? await fillHandWithFallback(participant.userId, baseHand, rules.dealPerPlayer)
        : await fillHandWithFallback(auth.user.id, baseHand, rules.dealPerPlayer);
    initialHandsBySeat[String(participant.seat)] = (Array.isArray(filled.cards) ? filled.cards : [])
      .map((c: any) => (c && typeof c === 'object' && c.kind === 'snapshot' && typeof c.id === 'string' ? c.id : null))
      .filter(Boolean) as string[];
    if (participant.kind === 'human') {
      const ok = await upsertPvpRoomHand(roomId, participant.userId, JSON.stringify(filled));
      if (!ok) {
        const rolledBack = await abortAndRollback('hand-write-failed', { userId: participant.userId });
        if (!rolledBack) {
          return json({ error: '写入手牌失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
        }
        return json({ error: '写入手牌失败' }, { status: 500 });
      }
      continue;
    }

    const bot = botById.get(participant.botId);
    if (bot) bot.hand = filled;
  }

  (internal.raw as any)._drawPile = drawPile;
  (internal.raw as any)._usedPile = [];
  (internal.raw as any)._initialHandsMatchId = matchId;
  (internal.raw as any)._initialHandsBySeat = initialHandsBySeat;
  (internal.raw as any)._submittedDataCardIds = [...submittedDataCardIds];
  (internal.raw as any)._submittedPresetFilenames = [...submittedPresetFilenames];
  (internal.raw as any)._publicDrawnCardIds = [...publicDrawnDataCardIds];
  (internal.raw as any)._presetDrawnFilenames = [...presetDrawnFilenames];

  const roundId = await createPvpRound({
    roomId,
    matchId,
    roundIndex: 1,
    status: 'pending',
    publicSnapshotJson: JSON.stringify({
      dealPerPlayer: rules.dealPerPlayer,
      cardsPerPlayer: rules.cardsPerPlayer,
      dealWhenEmpty: rules.dealWhenEmpty,
      drawSource: rules.drawSource,
      recycleUsedCards: rules.recycleUsedCards,
      dedupe: rules.dedupe,
      hiddenCount,
      mode: rules.mode,
      bestOf: rules.bestOf,
      showAllSubmissions: rules.showAllSubmissions,
      shuffleDecks: rules.shuffleDecks,
    }),
  });
  if (!roundId) {
    const rolledBack = await abortAndRollback('round-create-failed');
    if (!rolledBack) {
      return json({ error: '创建回合失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
    }
    return json({ error: '创建回合失败' }, { status: 500 });
  }

  // Bot 自动出牌：为本回合预先选择（失败则不阻塞开局）
  try {
    for (const b of internal.bots) {
      if (!b.hand?.cards?.length) continue;
      const snapshotIds = b.hand.cards.map((c: any) => (c && c.kind === 'snapshot' ? c.id : null)).filter(Boolean) as string[];
      const snapshots = [];
      for (const id of snapshotIds) {
        const snap = await getPvpCardSnapshotById(id);
        if (snap) snapshots.push(snap);
      }
      const picked = await pickBotChoiceSnapshotId({
        bot: { strategyId: b.strategyId },
        snapshots: snapshots.map((s) => ({ id: s.id, name: s.name, data_json: s.data_json, ref_json: s.ref_json })),
      });
      if (picked) {
        b.choicesByRoundId = { ...(b.choicesByRoundId ?? {}), [roundId]: picked };
      }
    }
  } catch {
    // ignore
  }

  const casToChoosing = await updatePvpRoomCas(roomId, dealingVersion, {
    phase: 'choosing',
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: new Date().toISOString(),
  });
  if (!casToChoosing) {
    return json({ success: true, roundId, warning: '发牌完成，但房间状态更新失败，请刷新' });
  }

  return json({ success: true, roundId, nextVersion: dealingVersion + 1 });
}

export default withPvpErrorBoundary(startHandler);
