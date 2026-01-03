import {
  createPvpRound,
  createPvpCardSnapshot,
  clearPvpRoomEphemeralState,
  getPvpCardSnapshotById,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomPlayers,
  getPvpRoundById,
  getPvpRoundsByMatch,
  getPvpMatchById,
  getRandomPublicCardExcluding,
  updatePvpMatch,
  updatePvpRoomCas,
  upsertPvpRoomHand,
} from '@/lib/d1';
import { pickBotChoiceSnapshotId } from '@/lib/pvp/bot/choose';
import { clearPvpRoomRuntimeFromRulesJson, parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { isPvpCombatantTypeAllowedByRange, normalizePvpRoomCardRange } from '@/lib/pvp/card-range';
import { inferPvpCombatantTypeFromJson } from '@/lib/pvp/logic';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { loadPresetCard } from '@/lib/pvp/preset';
import { BUNDLED_PRESET_FILENAMES } from '@/lib/pvp/preset-bundled';
import { getPvpFallbackDrawOrder } from '@/lib/pvp/drawSource';
import { getRoomIdFromRequestUrl, getRoundIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpHandState, PvpSnapshotRef } from '@/lib/pvp/types';

export const runtime = 'edge';

type ConfirmBody = { expectedVersion?: number };

type PostRoundState = {
  roundId: string;
  matchId: string;
  roundIndex: number;
  maxRounds: number;
  bestOfEnabled: boolean;
  resolvedWinnerUserId: number | null;
  confirmedUserIds: number[];
  confirmedBotIds: string[];
  confirmedAtByUserId: Record<string, string>;
  createdAt: string | null;
  updatedAt: string | null;
};

const parsePostRoundState = (raw: unknown): PostRoundState | null => {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as any;
  const roundId = typeof obj.roundId === 'string' ? obj.roundId : '';
  const matchId = typeof obj.matchId === 'string' ? obj.matchId : '';
  const roundIndex = Number.isFinite(obj.roundIndex) ? Math.floor(obj.roundIndex) : 0;
  const maxRounds = Number.isFinite(obj.maxRounds) ? Math.floor(obj.maxRounds) : 0;
  const bestOfEnabled = obj.bestOfEnabled === true;
  const resolvedWinnerUserId = typeof obj.resolvedWinnerUserId === 'number' ? obj.resolvedWinnerUserId : null;
  const confirmedUserIds = Array.isArray(obj.confirmedUserIds)
    ? obj.confirmedUserIds.filter((x: any) => typeof x === 'number' && Number.isFinite(x)).map((x: number) => Math.floor(x))
    : [];
  const confirmedBotIds = Array.isArray(obj.confirmedBotIds)
    ? obj.confirmedBotIds.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
    : [];
  const confirmedAtByUserId: Record<string, string> = {};
  const confirmedAtRaw = obj.confirmedAtByUserId;
  if (confirmedAtRaw && typeof confirmedAtRaw === 'object') {
    for (const [k, v] of Object.entries(confirmedAtRaw as Record<string, unknown>)) {
      const key = typeof k === 'string' ? k.trim() : '';
      const value = typeof v === 'string' ? v.trim() : '';
      if (key && value) confirmedAtByUserId[key] = value;
    }
  }
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : null;
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : null;

  if (!roundId || !matchId) return null;
  if (roundIndex <= 0) return null;
  if (maxRounds <= 0) return null;

  return {
    roundId,
    matchId,
    roundIndex,
    maxRounds,
    bestOfEnabled,
    resolvedWinnerUserId,
    confirmedUserIds,
    confirmedBotIds,
    confirmedAtByUserId,
    createdAt,
    updatedAt,
  };
};

const parseHand = (raw: string): PvpHandState | null => {
  try {
    const parsed = JSON.parse(raw) as PvpHandState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).cards) || !Array.isArray((parsed as any).discarded)) return null;
    return {
      cards: (parsed as any).cards as PvpSnapshotRef[],
      discarded: (parsed as any).discarded as PvpSnapshotRef[],
      drawPile: Array.isArray((parsed as any).drawPile) ? ((parsed as any).drawPile as PvpSnapshotRef[]) : [],
    };
  } catch {
    return null;
  }
};

const normalizeSnapshotRefArray = (raw: unknown): PvpSnapshotRef[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (c && typeof c === 'object' && (c as any).kind === 'snapshot' && typeof (c as any).id === 'string' ? ({ kind: 'snapshot', id: String((c as any).id) } as PvpSnapshotRef) : null))
    .filter(Boolean) as PvpSnapshotRef[];
};

const normalizeStringArray = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))];
};

async function confirmHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<ConfirmBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  const roundId = getRoundIdFromRequestUrl(req.url);
  if (!roomId || !roundId) return json({ error: '缺少参数' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase !== 'reviewing' && room.phase !== 'advancing') {
    return json({ error: '当前阶段不允许确认', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const internal = internalParsed.internal;
  const rules = internal.rules;
  const cardRange = normalizePvpRoomCardRange(rules);
  const bots = internal.bots;

  const players = await getPvpRoomPlayers(roomId);
  if (!players.some((p) => p.user_id === auth.user.id)) return json({ error: '你不在该房间中' }, { status: 403 });

  const round = await getPvpRoundById(roundId);
  if (!round || round.room_id !== roomId) return json({ error: '回合不存在' }, { status: 404 });
  if (round.status !== 'completed') return json({ error: '回合尚未结算', code: 'ROUND_NOT_COMPLETED' }, { status: 409 });

  const postRound = parsePostRoundState((internal.raw as any)._postRound);
  if (!postRound) return json({ error: '当前没有待确认的回合', code: 'NO_PENDING_CONFIRMATION' }, { status: 409 });
  if (postRound.roundId !== roundId) return json({ error: '确认目标不是当前待确认回合', code: 'ROUND_MISMATCH' }, { status: 409 });

  const totalPlayers = players.length + bots.length;
  const playerUserIds = players.map((p) => p.user_id);

  const confirmedUserIdSet = new Set<number>(postRound.confirmedUserIds);
  confirmedUserIdSet.add(auth.user.id);
  const nowIso = new Date().toISOString();
  const nextConfirmedAtByUserId: Record<string, string> = { ...(postRound.confirmedAtByUserId ?? {}) };
  nextConfirmedAtByUserId[String(auth.user.id)] = nowIso;

  const confirmedHumanCount = playerUserIds.filter((id) => confirmedUserIdSet.has(id)).length;
  const allHumansConfirmed = confirmedHumanCount >= players.length && players.length > 0;

  const confirmedBotIdsSet = new Set<string>(postRound.confirmedBotIds);
  for (const b of bots) confirmedBotIdsSet.add(b.id);

  const allConfirmed = allHumansConfirmed;

  if (room.phase === 'advancing') {
    return json({
      success: true,
      advancing: true,
      confirmedCount: confirmedHumanCount + bots.length,
      totalPlayers,
      hasConfirmedMe: true,
    });
  }

  (internal.raw as any)._postRound = {
    ...postRound,
    confirmedUserIds: [...confirmedUserIdSet],
    confirmedBotIds: [...confirmedBotIdsSet],
    confirmedAtByUserId: nextConfirmedAtByUserId,
    updatedAt: nowIso,
  };

  const phaseAfterConfirm = allConfirmed ? 'advancing' : 'reviewing';
  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    phase: phaseAfterConfirm,
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: nowIso,
  });
  if (!ok) return json({ error: '确认失败（版本冲突）', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (!allConfirmed) {
    return json({
      success: true,
      advanced: false,
      confirmedCount: confirmedHumanCount + bots.length,
      totalPlayers,
      hasConfirmedMe: true,
    });
  }

  // 只有抢到 advancing 的请求会继续推进（避免重复创建下一回合）
  const advancingVersion = expectedVersion + 1;

  const isLastRound = postRound.bestOfEnabled ? postRound.roundIndex >= postRound.maxRounds : true;

  if (!isLastRound) {
    const handsRows = await getPvpRoomHands(roomId);
    const handsByUserId = new Map<number, PvpHandState>();
    for (const row of handsRows) {
      const userId = typeof (row as any)?.user_id === 'number' ? (row as any).user_id : null;
      if (userId === null) continue;
      const parsed = parseHand((row as any).hand_json);
      if (!parsed) continue;
      handsByUserId.set(userId, parsed);
    }

    const dealWhenEmpty = Math.max(1, Math.floor(rules.dealWhenEmpty));
    let drawPile = normalizeSnapshotRefArray((internal.raw as any)?._drawPile);
    let usedPile = normalizeSnapshotRefArray((internal.raw as any)?._usedPile);
    const submittedDataCardIds = normalizeStringArray((internal.raw as any)?._submittedDataCardIds);
    const publicDrawnDataCardIds = new Set<string>(normalizeStringArray((internal.raw as any)?._publicDrawnCardIds));
    const excludePublicDataCardIds = new Set<string>([...submittedDataCardIds, ...publicDrawnDataCardIds]);
    const submittedPresetFilenames = normalizeStringArray((internal.raw as any)?._submittedPresetFilenames);
    const presetDrawnFilenames = new Set<string>(normalizeStringArray((internal.raw as any)?._presetDrawnFilenames));

    const dirtyUserIds = new Set<number>();

    const removeFromAllDiscards = (snapshotId: string) => {
      if (!snapshotId) return;
      for (const [userId, hand] of handsByUserId.entries()) {
        const before = Array.isArray(hand.discarded) ? hand.discarded.length : 0;
        const nextDiscarded = (Array.isArray(hand.discarded) ? hand.discarded : []).filter((c) => c?.kind === 'snapshot' && c.id !== snapshotId);
        if (nextDiscarded.length !== before) {
          handsByUserId.set(userId, { ...hand, discarded: nextDiscarded });
          dirtyUserIds.add(userId);
        }
      }
      for (const b of internal.bots) {
        if (!b.hand?.discarded?.length) continue;
        const before = b.hand.discarded.length;
        b.hand.discarded = b.hand.discarded.filter((c: any) => c?.kind === 'snapshot' && c.id !== snapshotId);
        if (b.hand.discarded.length !== before) {
          // bot hand is in rules_json，不需要额外标记
        }
      }
    };

    const drawPublicSnapshot = async (ownerUserId: number): Promise<PvpSnapshotRef | null> => {
      const statsOptions = {
        minLikeCount: cardRange.minLikeCount,
        maxLikeCount: cardRange.maxLikeCount,
        minUsageCount: cardRange.minUsageCount,
        maxUsageCount: cardRange.maxUsageCount,
        minFavoriteCount: cardRange.minFavoriteCount,
        maxFavoriteCount: cardRange.maxFavoriteCount,
      };

      for (let attempt = 0; attempt < 25; attempt++) {
        const row = await getRandomPublicCardExcluding('character', [...excludePublicDataCardIds], statsOptions);
        if (!row || typeof row.id !== 'string' || !row.id.trim()) return null;
        const dataCardId = String(row.id).trim();
        if (excludePublicDataCardIds.has(dataCardId)) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(String(row.data ?? '{}'));
        } catch {
          excludePublicDataCardIds.add(dataCardId);
          publicDrawnDataCardIds.add(dataCardId);
          continue;
        }

        const combatantType = inferPvpCombatantTypeFromJson(parsed);
        if (!isPvpCombatantTypeAllowedByRange(combatantType, cardRange)) {
          excludePublicDataCardIds.add(dataCardId);
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
          excludePublicDataCardIds.add(dataCardId);
          publicDrawnDataCardIds.add(dataCardId);
          continue;
        }

        excludePublicDataCardIds.add(dataCardId);
        publicDrawnDataCardIds.add(dataCardId);
        return { kind: 'snapshot', id: snapshotId };
      }

      return null;
    };

    const origin = getRequestOrigin(req);

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

    const drawPresetSnapshot = async (ownerUserId: number): Promise<PvpSnapshotRef | null> => {
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

    const drawFallbackSnapshot = async (ownerUserId: number): Promise<PvpSnapshotRef | null> => {
      for (const kind of getPvpFallbackDrawOrder(rules.drawSource)) {
        const snap = kind === 'preset' ? await drawPresetSnapshot(ownerUserId) : await drawPublicSnapshot(ownerUserId);
        if (snap) return snap;
      }
      return null;
    };

    const dealToHand = async (ownerUserId: number, hand: PvpHandState): Promise<PvpHandState> => {
      const nextCards: PvpSnapshotRef[] = [];
      let need = dealWhenEmpty;

      if (need > 0 && drawPile.length > 0) {
        const take = Math.min(need, drawPile.length);
        nextCards.push(...drawPile.slice(0, take));
        drawPile = drawPile.slice(take);
        need -= take;
      }

      if (need > 0 && rules.recycleUsedCards === true && usedPile.length > 0) {
        const take = Math.min(need, usedPile.length);
        const picked = usedPile.slice(0, take);
        usedPile = usedPile.slice(take);
        for (const c of picked) removeFromAllDiscards(c.id);
        nextCards.push(...picked);
        need -= take;
      }

      while (need > 0) {
        const snap = await drawFallbackSnapshot(ownerUserId);
        if (!snap) break;
        nextCards.push(snap);
        need -= 1;
      }

      if (nextCards.length <= 0) return hand;
      return { ...hand, cards: [...(Array.isArray(hand.cards) ? hand.cards : []), ...nextCards] };
    };

    // 先给所有“空手牌”的玩家补牌（按座位顺序）
    const sortedPlayers = [...players].sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
    for (const p of sortedPlayers) {
      const userId = p.user_id;
      const hand = handsByUserId.get(userId);
      if (!hand) continue;
      if (Array.isArray(hand.cards) && hand.cards.length > 0) continue;
      const next = await dealToHand(userId, hand);
      handsByUserId.set(userId, next);
      dirtyUserIds.add(userId);
    }

    for (const b of internal.bots) {
      if (!b.hand) continue;
      if (Array.isArray(b.hand.cards) && b.hand.cards.length > 0) continue;
      b.hand = await dealToHand(room.host_user_id, b.hand);
    }

    // 若仍有人空手，则不推进（避免下一回合无法出牌）
    const anyEmptyHuman = sortedPlayers.some((p) => {
      const hand = handsByUserId.get(p.user_id);
      return hand ? !(Array.isArray(hand.cards) && hand.cards.length > 0) : false;
    });
    const anyEmptyBot = internal.bots.some((b) => b.hand ? !(Array.isArray(b.hand.cards) && b.hand.cards.length > 0) : false);
    if (anyEmptyHuman || anyEmptyBot) {
      await updatePvpRoomCas(roomId, advancingVersion, {
        phase: 'reviewing',
        rules_json: stringifyPvpRoomInternalState(internal),
        last_activity_at: new Date().toISOString(),
      });
      return json({ error: '补牌失败：可用卡牌不足，请调整房间规则后重试', code: 'DEAL_WHEN_EMPTY_FAILED' }, { status: 409 });
    }

    // 持久化手牌与牌堆/公开库去重记录
    for (const p of sortedPlayers) {
      const userId = p.user_id;
      const hand = handsByUserId.get(userId);
      if (!hand) continue;
      if (!dirtyUserIds.has(userId)) continue;
      const ok = await upsertPvpRoomHand(roomId, userId, JSON.stringify(hand));
      if (!ok) {
        await updatePvpRoomCas(roomId, advancingVersion, {
          phase: 'reviewing',
          rules_json: stringifyPvpRoomInternalState(internal),
          last_activity_at: new Date().toISOString(),
        });
        return json({ error: '补牌失败：写入手牌数据失败，请稍后重试', code: 'DEAL_WHEN_EMPTY_WRITE_FAILED' }, { status: 500 });
      }
    }

    (internal.raw as any)._drawPile = drawPile;
    (internal.raw as any)._usedPile = usedPile;
    (internal.raw as any)._publicDrawnCardIds = [...publicDrawnDataCardIds];
    (internal.raw as any)._presetDrawnFilenames = [...presetDrawnFilenames];

    const nextRoundId = await createPvpRound({
      roomId,
      matchId: postRound.matchId,
      roundIndex: postRound.roundIndex + 1,
      status: 'pending',
    });

    if (!nextRoundId) {
      // best-effort：推进失败则退回 reviewing，便于重试
      await updatePvpRoomCas(roomId, advancingVersion, {
        phase: 'reviewing',
        rules_json: stringifyPvpRoomInternalState(internal),
        last_activity_at: new Date().toISOString(),
      });
      return json({ error: '创建下一回合失败，请稍后重试', code: 'NEXT_ROUND_CREATE_FAILED' }, { status: 500 });
    }

    // Bot 为下一轮预先出牌（失败则忽略，不阻塞推进）
    try {
      for (const b of internal.bots) {
        if (!b.hand?.cards?.length) continue;
        const snapshotIds = b.hand.cards.map((c: any) => (c && c.kind === 'snapshot' ? c.id : null)).filter(Boolean) as string[];
        const snapshots = [];
        for (const id of snapshotIds) {
          const snap = await getPvpCardSnapshotById(id);
          if (snap) snapshots.push(snap);
        }
        const pickedId =
          (await pickBotChoiceSnapshotId({
            bot: { strategyId: b.strategyId },
            snapshots: snapshots.map((s) => ({ id: s.id, name: s.name, data_json: s.data_json, ref_json: s.ref_json })),
          })) ?? (snapshotIds[0] ?? null);
        if (pickedId) {
          b.choicesByRoundId = { ...(b.choicesByRoundId ?? {}), [nextRoundId]: pickedId };
        }
      }
    } catch {
      // ignore
    }

    delete (internal.raw as any)._postRound;
    const casOk = await updatePvpRoomCas(roomId, advancingVersion, {
      phase: 'choosing',
      rules_json: stringifyPvpRoomInternalState(internal),
      last_activity_at: new Date().toISOString(),
    });
    if (!casOk) {
      return json({ success: true, advanced: true, nextRoundId, warning: '推进完成但房间状态更新失败，请刷新' });
    }

    return json({ success: true, advanced: true, nextRoundId });
  }

  // 最后一回合：结束整场对战
  const recordMatch = Boolean(await getPvpMatchById(postRound.matchId));
  let matchWinnerUserId: number | null = null;
  if (postRound.bestOfEnabled && recordMatch) {
    const rounds = await getPvpRoundsByMatch(postRound.matchId);
    const winCounts = new Map<number, number>();
    for (const p of players) winCounts.set(p.user_id, 0);
    for (const r of rounds) {
      if (!r.winner_user_id) continue;
      if (!winCounts.has(r.winner_user_id)) continue;
      winCounts.set(r.winner_user_id, (winCounts.get(r.winner_user_id) || 0) + 1);
    }
    let maxWins = 0;
    for (const wins of winCounts.values()) maxWins = Math.max(maxWins, wins);
    const top = [...winCounts.entries()].filter(([, wins]) => wins === maxWins).map(([userId]) => userId);
    matchWinnerUserId = top.length === 1 ? top[0]! : null;
  }

  const endedAt = new Date().toISOString();
  const matchResultJson = JSON.stringify({
    matchWinnerUserId: postRound.bestOfEnabled ? matchWinnerUserId : postRound.resolvedWinnerUserId,
    finalRoundIndex: postRound.roundIndex,
    bestOf: rules.bestOf,
  });
  if (recordMatch) {
    await updatePvpMatch(postRound.matchId, {
      status: 'completed',
      endedAt,
      winnerUserId: postRound.bestOfEnabled ? matchWinnerUserId : postRound.resolvedWinnerUserId,
      resultJson: matchResultJson,
    });
  }

  delete (internal.raw as any)._postRound;
  const compactRulesJson = clearPvpRoomRuntimeFromRulesJson(stringifyPvpRoomInternalState(internal));
  const finishOk = await updatePvpRoomCas(roomId, advancingVersion, {
    phase: 'finished',
    rules_json: compactRulesJson,
    last_activity_at: endedAt,
  });
  if (!finishOk) {
    return json({ success: true, advanced: true, finished: true, matchWinnerUserId, warning: '对局结束但房间状态更新失败，请刷新' });
  }

  const cleanupPromise = clearPvpRoomEphemeralState(roomId);
  const executionContext = (req as any).context;
  if (executionContext?.waitUntil) {
    executionContext.waitUntil(cleanupPromise);
  } else {
    cleanupPromise.catch((error) => console.warn('PVP 房间临时数据清理失败（非阻塞）:', error));
  }

  return json({ success: true, advanced: true, finished: true, matchWinnerUserId });
}

export default withPvpErrorBoundary(confirmHandler);
