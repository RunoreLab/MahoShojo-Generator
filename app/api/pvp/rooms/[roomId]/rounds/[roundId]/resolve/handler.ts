import {
  getPvpCardSnapshotById,
  getPvpEligibleScenarioDataCard,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomMembers,
  getPvpRoomPlayers,
  getPvpRoundById,
  getPvpRoundChoices,
  updatePvpRoomCas,
  updatePvpRound,
  upsertPvpRoomHand,
} from '@/lib/database/pvp';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { CustomProviderSchema } from '@/lib/arena/schemas';
import type { CustomProviderPayload } from '@/lib/ai/custom-provider';
import { pickBotChoiceSnapshotId } from '@/lib/pvp/bot/choose';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { normalizeWinnerFromCandidates } from '@/lib/pvp/logic';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { loadScenarioPresetPayload } from '@/lib/pvp/scenario-preset';
import { getRoomIdFromRequestUrl, getRoundIdFromRequestUrl } from '@/lib/pvp/route';
import { getPvpScenarioTitle, parsePvpScenarioSelection } from '@/lib/pvp/scenario';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import { buildPvpSensitiveArrestWarrantReport } from '@/lib/pvp/arrest-warrant';
import type { PvpHandState, PvpSnapshotRef } from '@/lib/pvp/types';
import { createPvpWinnerVoteState } from '@/lib/pvp/winner-vote';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';
import { resolvePvpAdjudicationEvents } from '@/lib/pvp/adjudication-events';

type ResolveBody = { expectedVersion?: number; customProvider?: unknown; force?: boolean };

type PvpPickedSnapshot = NonNullable<Awaited<ReturnType<typeof getPvpCardSnapshotById>>>;

type PvpPickedPlayer = {
  userId: number | null;
  seat: number;
  username: string | null;
  prefix: string | null;
  token: string;
  snapshot: PvpPickedSnapshot;
  characterGuidance?: string | null;
  isBot?: boolean;
  botId?: string | null;
};

type ParsedChoice = { ref: PvpSnapshotRef; characterGuidance: string | null };

const parseChoice = (raw: string): ParsedChoice | null => {
  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || parsed.kind !== 'snapshot' || typeof parsed.id !== 'string') return null;
    const characterGuidance =
      typeof parsed.characterGuidance === 'string' ? parsed.characterGuidance.trim().slice(0, 100) : '';
    return {
      ref: { kind: 'snapshot', id: parsed.id } as PvpSnapshotRef,
      characterGuidance: characterGuidance || null,
    };
  } catch {
    return null;
  }
};

const parseHand = (raw: string): PvpHandState | null => {
  try {
    const parsed = JSON.parse(raw) as PvpHandState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards) || !Array.isArray(parsed.discarded)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const moveToDiscard = (hand: PvpHandState, snapshotId: string): PvpHandState => {
  const cards = hand.cards.filter((c) => c.kind === 'snapshot' && c.id !== snapshotId);
  const discarded = [...hand.discarded, { kind: 'snapshot', id: snapshotId } as PvpSnapshotRef];
  return { ...hand, cards, discarded };
};

const isJsonLike = (contentType: string | null, rawText: string): boolean => {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html')) return false;
  if (ct.includes('application/json') || ct.includes('+json') || ct.includes('text/json')) return true;
  const trimmed = rawText.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

const stripPrivateKeys = (value: any): any => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripPrivateKeys);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (key.startsWith('_')) continue;
    out[key] = stripPrivateKeys(value[key]);
  }
  return out;
};

async function resolveHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<ResolveBody>(req);
  if ('response' in body) return body.response;

  const rawCustomProvider = (body.data as ResolveBody).customProvider;
  let customProvider: CustomProviderPayload | null = null;
  if (rawCustomProvider !== undefined) {
    const parsed = CustomProviderSchema.safeParse(rawCustomProvider);
    if (!parsed.success) return json({ error: '自定义 AI 供应商配置无效' }, { status: 400 });

    const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === parsed.data.providerId);
    if (!providerConfig) return json({ error: '未知的模型供应商 ID' }, { status: 400 });
    const modelResolution = resolveAIProviderModel(providerConfig, parsed.data.modelId);
    if (!modelResolution) return json({ error: '未知的模型 ID' }, { status: 400 });

    const apiKey = parsed.data.apiKey.trim();
    if (providerConfig.id !== 'system' && !apiKey) return json({ error: 'API Key 不能为空' }, { status: 400 });

    // 与竞技场保持一致：系统默认策略（modelId=default）不需要透传到生成接口
    if (!(providerConfig.id === 'system' && parsed.data.modelId === 'default')) {
      customProvider = { ...parsed.data, modelId: modelResolution.modelId, apiKey };
    }
  }

  const roomId = getRoomIdFromRequestUrl(req.url);
  const roundId = getRoundIdFromRequestUrl(req.url);
  if (!roomId || !roundId) return json({ error: '缺少参数' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase !== 'choosing' && room.phase !== 'resolving' && room.phase !== 'reviewing') {
    return json({ error: '当前阶段不允许结算', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }
  const force = (body.data as ResolveBody).force === true;
  if (force && auth.user.id !== room.host_user_id) {
    return json({ error: '只有房主可以强制重试结算', code: 'FORCE_FORBIDDEN' }, { status: 403 });
  }
  if (room.phase === 'resolving' && !force) {
    return json({ error: '正在结算中，请稍后刷新', code: 'ROOM_RESOLVING' }, { status: 409 });
  }

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const internal = internalParsed.internal;
  const rules = internal.rules;
  const bots = internal.bots;
  const scenarioSelection = parsePvpScenarioSelection((internal.raw as any)?._scenario);
  if (rules.mode === 'scenario' && !scenarioSelection) {
    return json({ error: '当前为情景模式，但尚未选择情景', code: 'SCENARIO_MISSING' }, { status: 409 });
  }

  let scenarioPayload: Record<string, unknown> | null = null;
  let scenarioSourceDataCardId: string | null = null;
  let scenarioSourceDataCardUpdatedAt: string | null = null;
  if (rules.mode === 'scenario' && scenarioSelection) {
    if (scenarioSelection.kind === 'preset') {
      try {
        const origin = getRequestOrigin(req);
        scenarioPayload = stripPrivateKeys(await loadScenarioPresetPayload(origin, scenarioSelection.filename)) as Record<string, unknown>;
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : '预设情景读取失败', code: 'SCENARIO_PRESET_LOAD_FAILED' }, { status: 500 });
      }
    } else {
      const row = await getPvpEligibleScenarioDataCard(scenarioSelection.id, room.host_user_id);
      if (!row) {
        return json({ error: '所选情景已不可用（可能未通过审查/已被封禁/已删除），请房主重新选择情景', code: 'SCENARIO_NOT_ELIGIBLE' }, { status: 409 });
      }
      const expectedUpdatedAt = typeof scenarioSelection.updatedAt === 'string' ? scenarioSelection.updatedAt : null;
      const actualUpdatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
      if (expectedUpdatedAt && actualUpdatedAt && expectedUpdatedAt !== actualUpdatedAt) {
        return json({ error: '情景数据卡版本已变更，请房主重新选择情景后再结算', code: 'SCENARIO_VERSION_MISMATCH', expected: expectedUpdatedAt, actual: actualUpdatedAt }, { status: 409 });
      }

      scenarioSourceDataCardId = row.id;
      scenarioSourceDataCardUpdatedAt = actualUpdatedAt;

      try {
        const parsedScenario = JSON.parse(row.data);
        if (!parsedScenario || typeof parsedScenario !== 'object' || Array.isArray(parsedScenario)) {
          return json({ error: '情景数据卡内容损坏（不是有效 JSON 对象）', code: 'SCENARIO_JSON_INVALID' }, { status: 500 });
        }
        scenarioPayload = stripPrivateKeys(parsedScenario) as Record<string, unknown>;
      } catch {
        return json({ error: '情景数据卡内容损坏（不是有效 JSON）', code: 'SCENARIO_JSON_INVALID' }, { status: 500 });
      }
    }
  }

  const allowNonHostControl = rules.allowNonHostControl === true;
  if (!allowNonHostControl && auth.user.id !== room.host_user_id) {
    return json({ error: '仅房主可结算（房主可在房间设置中允许其他玩家结算）', code: 'RESOLVE_FORBIDDEN' }, { status: 403 });
  }

  const players = await getPvpRoomPlayers(roomId);
  const sortedPlayers = [...players].sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
  if (!sortedPlayers.some((p) => p.user_id === auth.user.id)) return json({ error: '你不在该房间中' }, { status: 403 });
  if (sortedPlayers.some((p) => typeof p.seat !== 'number')) return json({ error: '房间座位异常' }, { status: 500 });
  if (bots.some((b) => !Number.isFinite(b.seat))) return json({ error: '机器人座位异常' }, { status: 500 });

  const usedSeats = new Set<number>();
  for (const p of sortedPlayers) usedSeats.add(p.seat as number);
  for (const b of bots) {
    if (usedSeats.has(b.seat)) return json({ error: '座位冲突（机器人与玩家座位重复）', code: 'SEAT_CONFLICT' }, { status: 500 });
    usedSeats.add(b.seat);
  }

  const participants = [
    ...sortedPlayers.map((p) => ({ kind: 'human' as const, seat: p.seat as number, userId: p.user_id, username: p.username ?? null, prefix: p.prefix ?? null })),
    ...bots.map((b) => ({ kind: 'bot' as const, seat: b.seat, botId: b.id, name: b.name, strategyId: b.strategyId })),
  ].sort((a, b) => a.seat - b.seat);
  if (participants.length !== rules.participants) return json({ error: '房间参与者数量与规则不一致' }, { status: 500 });
  const humanCount = sortedPlayers.length;

  const round = await getPvpRoundById(roundId);
  if (!round || round.room_id !== roomId) return json({ error: '回合不存在' }, { status: 404 });
  const matchId = round.match_id ?? room.current_match_id;
  if (!matchId) return json({ error: '对战上下文缺失，请房主重开房间后再试', code: 'MATCH_CONTEXT_MISSING' }, { status: 409 });

  // 幂等：回合已完成则直接返回结果
  if (round.status === 'completed' && round.result_json) {
    return json({ success: true, alreadyResolved: true, result: JSON.parse(round.result_json) });
  }
  if (room.phase === 'reviewing') {
    return json({ error: '回合已结算，正在等待全员确认后推进', code: 'WAITING_CONFIRMATION' }, { status: 409 });
  }
  if (round.status === 'resolving' && !force) {
    return json({ error: '正在结算中，请稍后刷新', code: 'ROUND_RESOLVING' }, { status: 409 });
  }
  if (round.status !== 'pending' && round.status !== 'resolving') {
    return json({ error: '回合不可结算', code: 'ROUND_FORBIDDEN' }, { status: 409 });
  }

  const choices = await getPvpRoundChoices(roundId);
  if (choices.length < humanCount) return json({ error: '仍有玩家未选择出战卡' }, { status: 409 });

  const choiceByUserId = new Map<number, ParsedChoice>();
  for (const row of choices) {
    const parsed = parseChoice(row.choice_ref_json);
    if (!parsed) return json({ error: '选择数据损坏' }, { status: 500 });
    choiceByUserId.set(row.user_id, parsed);
  }

  const missing = sortedPlayers.filter((p) => !choiceByUserId.has(p.user_id));
  if (missing.length > 0) return json({ error: '仍有玩家未选择出战卡' }, { status: 409 });

  const chooseForBot = async (botId: string): Promise<string | null> => {
    const bot = internal.bots.find((b) => b.id === botId);
    if (!bot) return null;
    const cached = bot.choicesByRoundId?.[roundId];
    if (cached) return cached;
    if (!bot.hand?.cards?.length) return null;

    const snapshotIds = bot.hand.cards
      .map((c: any) => (c && c.kind === 'snapshot' ? c.id : null))
      .filter(Boolean) as string[];
    const snapshots = [];
    for (const id of snapshotIds) {
      const snap = await getPvpCardSnapshotById(id);
      if (snap) snapshots.push(snap);
    }
    const picked =
      (await pickBotChoiceSnapshotId({
        bot: { strategyId: bot.strategyId },
        snapshots: snapshots.map((s) => ({ id: s.id, name: s.name, data_json: s.data_json, ref_json: s.ref_json })),
      })) ?? (snapshotIds[0] ?? null);

    if (picked) {
      bot.choicesByRoundId = { ...(bot.choicesByRoundId ?? {}), [roundId]: picked };
    }
    return picked;
  };

  const picked: PvpPickedPlayer[] = [];
  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i]!;
    const token = `P${i + 1}`;
    if (participant.kind === 'human') {
      const choice = choiceByUserId.get(participant.userId)!;
      const snap = await getPvpCardSnapshotById(choice.ref.id);
      if (!snap) return json({ error: '快照不存在，请重试' }, { status: 409 });
      picked.push({
        userId: participant.userId,
        seat: participant.seat,
        username: participant.username,
        prefix: participant.prefix,
        token,
        snapshot: snap,
        characterGuidance: choice.characterGuidance,
        isBot: false,
      });
      continue;
    }

    const snapshotId = await chooseForBot(participant.botId);
    if (!snapshotId) return json({ error: '机器人出牌失败（缺少手牌或策略异常）', code: 'BOT_CHOOSE_FAILED' }, { status: 409 });
    const snap = await getPvpCardSnapshotById(snapshotId);
    if (!snap) return json({ error: '快照不存在，请重试' }, { status: 409 });
    picked.push({
      userId: null,
      seat: participant.seat,
      username: participant.name,
      prefix: null,
      token,
      snapshot: snap,
      isBot: true,
      botId: participant.botId,
    });
  }

  // CAS：进入 resolving（避免重复触发）
  if (room.phase === 'choosing') {
    const ok = await updatePvpRoomCas(roomId, expectedVersion, { phase: 'resolving', last_activity_at: new Date().toISOString() });
    if (!ok) {
      // 竞争下可能被其它请求先推进，读取最新状态后继续（幂等）
      const refreshed = await getPvpRoomById(roomId);
      if (!refreshed) return json({ error: '房间不存在' }, { status: 404 });
      if (refreshed.phase !== 'resolving' && refreshed.phase !== 'finished') {
        return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });
      }
    }
  }
  const resolvingVersion = room.phase === 'choosing' ? expectedVersion + 1 : expectedVersion;

  await updatePvpRound(roundId, { status: 'resolving' });

  const origin = getRequestOrigin(req);
  const authHeader = req.headers.get('authorization') || '';
  const subrequestAuthHeaders = buildSubrequestAuthHeaders(req);

  const candidateTokens = picked.map((p) => p.token);
  const candidateNames = picked.map((p) => p.snapshot.name);

  const buildGuidance = (attempt: number) => {
    const mapping = picked.map((p) => `- ${p.token}：${p.snapshot.name}`).join('\n');
    const tokenList = candidateTokens.map((t) => `“${t}”`).join('、');
    const base = [
      '【PVP 裁判规则】',
      `本轮参战者：\n${mapping}。`,
      `你必须在 officialReport.winner 字段只输出以下之一：${tokenList} 或 “平局”。`,
      '输出必须完全一致（不要加任何解释、标点或额外文字）。',
      '战报正文中请继续使用角色名叙述，不要在正文中使用 P1/P2…代号。',
    ].join('\n');
    if (attempt === 0) return base;
    return `${base}\n【纠错】你上一轮的 officialReport.winner 不符合规则，请严格按规则输出。`;
  };

  let report: any | null = null;
  let updatedCombatants: any[] | null = null;
  let rawWinnerText: string | null = null;
  let attempts = 0;
  let winnerIndex: number | null = null;
  let isDraw = false;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    attempts = attempt + 1;
    try {
      const res = await fetch(new URL('/api/generate-battle-story', origin).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...subrequestAuthHeaders,
        },
      body: JSON.stringify({
        combatants: picked.map((p) => ({
          type: p.snapshot.card_type,
          data: JSON.parse(p.snapshot.data_json),
          isNative: false,
          isPreset: false,
          characterGuidance: p.characterGuidance ?? null,
        })),
        mode: rules.mode,
          ...(rules.mode === 'scenario' && scenarioPayload
            ? {
                scenario: scenarioPayload,
                scenarioTitle: (scenarioSelection ? getPvpScenarioTitle(scenarioSelection) : null) || undefined,
                scenarioSourceDataCardId: scenarioSourceDataCardId || undefined,
                scenarioSourceDataCardUpdatedAt: scenarioSourceDataCardUpdatedAt || undefined,
              }
            : {}),
          ...(rules.language?.trim() ? { language: rules.language.trim() } : {}),
          ...(rules.storyLength ? { storyLength: rules.storyLength } : {}),
          internalGuidance: buildGuidance(attempt),
          ...(rules.userGuidance?.trim() ? { userGuidance: rules.userGuidance.trim() } : {}),
          readArenaHistory: rules.readArenaHistory,
          ...(rules.readArenaHistory
            ? { arenaHistoryReadLimit: rules.isArenaHistoryUnlimited ? null : rules.readArenaHistoryLimit }
            : {}),
          writeArenaHistory: rules.writeArenaHistory,
          readCurrentState: rules.readCurrentState,
          writeCurrentState: rules.writeCurrentState,
          adjudicationEvents: resolvePvpAdjudicationEvents({ roomEvents: rules.adjudicationEvents, scenarioPayload }),
          ...(customProvider ? { customProvider } : {}),
          pvpContext: {
            roomId,
            matchId,
            roundId,
          },
        }),
      });

      const raw = await res.text();

      if (!res.ok) {
        let generationId: string | null = null;
        let errorMessage: string | null = null;
        let shouldRedirect = false;
        let redirectReason: string | null = null;
        if (isJsonLike(res.headers.get('content-type'), raw)) {
          try {
            const parsed = JSON.parse(raw);
            generationId = typeof parsed?.generationId === 'string' ? parsed.generationId : null;
            errorMessage = typeof parsed?.error === 'string' ? parsed.error : null;
            shouldRedirect = Boolean(parsed?.shouldRedirect) || parsed?.redirect === '/arrested';
            redirectReason = typeof parsed?.reason === 'string' ? parsed.reason : null;
          } catch {
            generationId = null;
            errorMessage = null;
          }
        }

        if (generationId) {
          await updatePvpRound(roundId, { battleGenerationId: generationId });
        }

        // PVP 特殊处理：敏感词触发逮捕时，不跳转 /arrested，而是将战报改为“逮捕令”并判定平局。
        if (shouldRedirect) {
          report = buildPvpSensitiveArrestWarrantReport({
            reason: redirectReason,
            roomId,
            matchId,
            roundId,
            issuedAt: new Date(),
          });
          rawWinnerText = '平局';
          isDraw = true;
          winnerIndex = null;
          lastError = null;
          break;
        }

        if (!isJsonLike(res.headers.get('content-type'), raw)) {
          const preview = raw.trim().slice(0, 160);
          const contentType = res.headers.get('content-type') || 'unknown';
          lastError = `战报生成接口返回的不是 JSON（HTTP ${res.status}，Content-Type: ${contentType}）${preview ? `\n预览：${preview}` : ''}`;
          continue;
        }

        lastError = errorMessage || raw || '战报生成失败';
        continue;
      }

      if (!isJsonLike(res.headers.get('content-type'), raw)) {
        const preview = raw.trim().slice(0, 160);
        const contentType = res.headers.get('content-type') || 'unknown';
        lastError = `战报生成接口返回的不是 JSON（Content-Type: ${contentType}）${preview ? `\n预览：${preview}` : ''}`;
        continue;
      }

      let data: any;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'JSON 解析失败';
        const preview = raw.trim().slice(0, 160);
        lastError = `战报生成接口 JSON 解析失败：${message}${preview ? `\n预览：${preview}` : ''}`;
        continue;
      }

      const generationId = typeof data?.generationId === 'string' ? data.generationId : null;
      if (generationId) {
        await updatePvpRound(roundId, { battleGenerationId: generationId });
      }
      report = data?.report ?? null;
      updatedCombatants = Array.isArray(data?.updatedCombatants) ? data.updatedCombatants : null;
      const adjudicationResults = Array.isArray(data?.adjudicationResults) ? data.adjudicationResults : null;
      if (report && adjudicationResults) {
        report.adjudicationResults = adjudicationResults;
      }
      if (report && rules.mode === 'scenario' && scenarioSelection) {
        report.scenario = getPvpScenarioTitle(scenarioSelection) || undefined;
      }
      rawWinnerText = report?.officialReport?.winner ?? null;
      const byToken = normalizeWinnerFromCandidates(rawWinnerText, candidateTokens);
      if (byToken.kind === 'draw') {
        isDraw = true;
        winnerIndex = null;
        break;
      }
      if (byToken.kind === 'index') {
        isDraw = false;
        winnerIndex = byToken.index;
        break;
      }

      const byName = normalizeWinnerFromCandidates(rawWinnerText, candidateNames);
      if (byName.kind === 'draw') {
        isDraw = true;
        winnerIndex = null;
        break;
      }
      if (byName.kind === 'index') {
        const name = candidateNames[byName.index]!;
        const occurrences = candidateNames.filter((n) => n === name).length;
        if (occurrences === 1) {
          isDraw = false;
          winnerIndex = byName.index;
          break;
        }
      }

      lastError = 'winner 不合法，请重试';
    } catch (error) {
      lastError = error instanceof Error ? error.message : '战报生成失败';
    }
  }

  // 生成失败：不要直接判平局并结束对局，否则前端只会看到“对局已结束”却没有战报卡片。
  // 这里回退到 choosing + pending，允许玩家/房主直接重试结算。
  if (!report) {
    await updatePvpRound(roundId, { status: 'pending' });
    await updatePvpRoomCas(roomId, resolvingVersion, { phase: 'choosing', last_activity_at: new Date().toISOString() });
    return json(
      {
        error: '战报生成失败，请稍后重试',
        code: 'BATTLE_REPORT_GENERATION_FAILED',
        detail: lastError || 'unknown',
        attempts,
      },
      { status: 502 }
    );
  }

  const winnerUserIdRaw = isDraw || winnerIndex === null ? null : picked[winnerIndex]!.userId;
  const shouldStartWinnerVote = !isDraw && winnerIndex === null;
  const resolvedWinnerUserId = shouldStartWinnerVote ? null : (typeof winnerUserIdRaw === 'number' ? winnerUserIdRaw : null);
  const resolvedWinnerName = shouldStartWinnerVote ? null : (isDraw || winnerIndex === null ? '平局' : picked[winnerIndex]!.snapshot.name);
  const officialWinnerName = shouldStartWinnerVote ? '待定（投票中）' : (resolvedWinnerName ?? '平局');

  if (report?.officialReport) {
    report.officialReport.winner = officialWinnerName;
  }

  const resultJson = JSON.stringify({
    winnerUserId: resolvedWinnerUserId,
    winnerName: resolvedWinnerName,
    winnerSeat: shouldStartWinnerVote ? null : (isDraw || winnerIndex === null ? null : picked[winnerIndex]!.seat),
    winnerToken: shouldStartWinnerVote ? null : (isDraw || winnerIndex === null ? null : picked[winnerIndex]!.token),
    winnerIsBot: shouldStartWinnerVote ? null : (isDraw || winnerIndex === null ? null : Boolean(picked[winnerIndex]!.isBot)),
    winnerStatus: shouldStartWinnerVote ? 'pending_vote' : 'final',
    winnerVote: shouldStartWinnerVote
      ? {
          status: 'open',
          reason: 'auto_invalid',
          createdAt: new Date().toISOString(),
          createdByUserId: auth.user.id,
        }
      : null,
    rawWinnerText,
    attempts,
    error: winnerIndex === null && !isDraw ? (lastError || 'winner 不合法，已触发胜者投票') : null,
    combatants: picked.map((p) => ({
      token: p.token,
      userId: p.userId,
      seat: p.seat,
      isBot: Boolean(p.isBot),
      botId: p.botId ?? null,
      snapshotId: p.snapshot.id,
      name: p.snapshot.name,
      type: p.snapshot.card_type,
      ...(p.characterGuidance ? { characterGuidance: p.characterGuidance } : {}),
    })),
    report,
    updatedCombatants: updatedCombatants ?? [],
  });

  await updatePvpRound(roundId, {
    status: 'completed',
    resultJson,
    winnerUserId: resolvedWinnerUserId,
    winnerName: resolvedWinnerName,
  });

  // 更新手牌：移除出牌并放入弃牌
  const hands = await getPvpRoomHands(roomId);
  for (const p of picked) {
    if (typeof p.userId === 'number') {
      const handRow = hands.find((h) => h.user_id === p.userId);
      if (!handRow) continue;
      const parsed = parseHand(handRow.hand_json);
      if (!parsed) continue;
      await upsertPvpRoomHand(roomId, p.userId, JSON.stringify(moveToDiscard(parsed, p.snapshot.id)));
      continue;
    }

    if (p.isBot && p.botId) {
      const bot = internal.bots.find((b) => b.id === p.botId);
      if (bot?.hand) {
        bot.hand = moveToDiscard(bot.hand, p.snapshot.id);
      }
    }
  }

  // 记录已使用卡牌：用于“可重复发放已使用卡”设置的第二顺位来源
  const usedPileRaw = (internal.raw as any)?._usedPile;
  const usedPile: PvpSnapshotRef[] = Array.isArray(usedPileRaw)
    ? (usedPileRaw as any[])
        .map((c) => (c && typeof c === 'object' && c.kind === 'snapshot' && typeof c.id === 'string' ? ({ kind: 'snapshot', id: c.id } as PvpSnapshotRef) : null))
        .filter(Boolean) as PvpSnapshotRef[]
    : [];
  const usedSet = new Set<string>(usedPile.map((c) => c.id));
  for (const p of picked) {
    const id = p.snapshot.id;
    if (typeof id !== 'string' || !id) continue;
    if (usedSet.has(id)) continue;
    usedSet.add(id);
    usedPile.push({ kind: 'snapshot', id });
  }
  (internal.raw as any)._usedPile = usedPile;

  if (shouldStartWinnerVote) {
    const members = await getPvpRoomMembers(roomId);
    const eligibleUserIds = members
      .map((m) => (typeof m?.user_id === 'number' && Number.isFinite(m.user_id) ? Math.floor(m.user_id) : null))
      .filter((id): id is number => typeof id === 'number' && id > 0);

    (internal.raw as any)._winnerVote = createPvpWinnerVoteState({
      roundId,
      matchId,
      createdAt: new Date().toISOString(),
      createdByUserId: auth.user.id,
      reason: 'auto_invalid',
      eligibleUserIds,
    });
    delete (internal.raw as any)._postRound;

    await updatePvpRoomCas(roomId, resolvingVersion, {
      phase: 'voting',
      rules_json: stringifyPvpRoomInternalState(internal),
      last_activity_at: new Date().toISOString(),
    });

    return json({ success: true, roundResolved: true, result: JSON.parse(resultJson), waitingVote: true });
  }

  // 等待全员确认后再推进下一回合/结束（避免战报刚生成就被刷新覆盖）
  const maxRounds = rules.bestOf.enabled ? rules.bestOf.maxRounds : 1;
  (internal.raw as any)._postRound = {
    roundId,
    matchId,
    roundIndex: round.round_index,
    maxRounds,
    bestOfEnabled: rules.bestOf.enabled,
    resolvedWinnerUserId,
    confirmedUserIds: [],
    confirmedBotIds: internal.bots.map((b) => b.id),
    confirmedAtByUserId: {},
    createdAt: new Date().toISOString(),
  };

  await updatePvpRoomCas(roomId, resolvingVersion, {
    phase: 'reviewing',
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: new Date().toISOString(),
  });

  return json({ success: true, roundResolved: true, result: JSON.parse(resultJson), waitingConfirmation: true });
}

export const appRouteHandler = withPvpErrorBoundary(resolveHandler);
export default appRouteHandler;
