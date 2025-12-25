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
} from '@/lib/d1';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { CustomProviderSchema } from '@/lib/arena/schemas';
import { extractStreamUpdateMeta, stripStreamUpdateMetaComment } from '@/lib/arena/stream-meta';
import { extractWinnerFromText } from '@/lib/arena/battle-report-log-utils';
import { pickBotChoiceSnapshotId } from '@/lib/pvp/bot/choose';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { normalizeWinnerFromCandidates } from '@/lib/pvp/logic';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { getRoomIdFromRequestUrl, getRoundIdFromRequestUrl } from '@/lib/pvp/route';
import { getPvpScenarioTitle, parsePvpScenarioSelection } from '@/lib/pvp/scenario';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import { buildPvpSensitiveArrestWarrantReport } from '@/lib/pvp/arrest-warrant';
import type { PvpHandState, PvpSnapshotRef } from '@/lib/pvp/types';
import { createPvpWinnerVoteState } from '@/lib/pvp/winner-vote';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';
import { extractWinnerLineFromMarkdown, parsePvpWinnerFromText } from '@/lib/pvp/winner-parse';

export const runtime = 'edge';

type ResolveBody = { expectedVersion?: number; customProvider?: unknown; force?: boolean };

type PvpPickedSnapshot = NonNullable<Awaited<ReturnType<typeof getPvpCardSnapshotById>>>;

type PvpPickedPlayer = {
  userId: number | null;
  seat: number;
  username: string | null;
  prefix: string | null;
  token: string;
  snapshot: PvpPickedSnapshot;
  isBot?: boolean;
  botId?: string | null;
};

const parseChoice = (raw: string): PvpSnapshotRef | null => {
  try {
    const parsed = JSON.parse(raw) as PvpSnapshotRef;
    if (!parsed || parsed.kind !== 'snapshot' || typeof parsed.id !== 'string') return null;
    return parsed;
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

const buildMarkdownFromArrestReport = (report: ReturnType<typeof buildPvpSensitiveArrestWarrantReport>): string => {
  const title = typeof report?.headline === 'string' && report.headline.trim() ? report.headline.trim() : '调查院逮捕令';
  const body = typeof report?.article?.body === 'string' ? report.article.body.trim() : '';
  const head = `# ${title}\n`;
  return body ? `${head}\n${body}\n` : `${head}\n`;
};

async function resolveStreamHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<ResolveBody>(req);
  if ('response' in body) return body.response;

  const rawCustomProvider = (body.data as ResolveBody).customProvider;
  let customProvider: { providerId: string; modelId: string; apiKey: string } | null = null;
  if (rawCustomProvider !== undefined) {
    const parsed = CustomProviderSchema.safeParse(rawCustomProvider);
    if (!parsed.success) return json({ error: '自定义 AI 供应商配置无效' }, { status: 400 });

    const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === parsed.data.providerId);
    if (!providerConfig) return json({ error: '未知的模型供应商 ID' }, { status: 400 });
    const modelConfig = providerConfig.models.find((model) => model.value === parsed.data.modelId);
    if (!modelConfig) return json({ error: '未知的模型 ID' }, { status: 400 });

    const apiKey = parsed.data.apiKey.trim();
    if (providerConfig.id !== 'system' && !apiKey) return json({ error: 'API Key 不能为空' }, { status: 400 });

    if (!(providerConfig.id === 'system' && parsed.data.modelId === 'default')) {
      customProvider = { ...parsed.data, apiKey };
    }
  }

  const force = (body.data as ResolveBody).force === true;
  const expectedVersion = Number.isFinite((body.data as ResolveBody).expectedVersion) ? Math.floor((body.data as ResolveBody).expectedVersion!) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });

  const roomId = getRoomIdFromRequestUrl(req.url);
  const roundId = getRoundIdFromRequestUrl(req.url);
  if (!roomId || !roundId) return json({ error: '缺少参数' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });

  const parsedRoom = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsedRoom) return json({ error: parsedRoom.error }, { status: 500 });
  const internal = parsedRoom.internal;
  const rules = internal.rules;
  const bots = internal.bots;

  if (rules.generationMode !== 'stream') {
    return json({ error: '该房间未开启流式生成', code: 'STREAM_DISABLED' }, { status: 409 });
  }

  const scenarioSelection = parsePvpScenarioSelection((internal.raw as any)?._scenario);
  let scenarioPayload: Record<string, unknown> | null = null;
  let scenarioSourceDataCardId: string | null = null;
  let scenarioSourceDataCardUpdatedAt: string | null = null;
  if (rules.mode === 'scenario') {
    if (!scenarioSelection) {
      return json({ error: '情景模式必须先设置房间情景', code: 'SCENARIO_REQUIRED' }, { status: 409 });
    }
    const row = await getPvpEligibleScenarioDataCard(scenarioSelection.id, room.host_user_id);
    if (!row) return json({ error: '情景不可用：可能已被删除/封禁/无权限', code: 'SCENARIO_NOT_FOUND' }, { status: 409 });
    const actualUpdatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : null;
    const expectedUpdatedAt = scenarioSelection.updatedAt ? new Date(scenarioSelection.updatedAt).toISOString() : null;
    if (expectedUpdatedAt && actualUpdatedAt && expectedUpdatedAt !== actualUpdatedAt) {
      return json({ error: '情景已更新，请重新选择后再试', code: 'SCENARIO_VERSION_MISMATCH', detail: { expected: expectedUpdatedAt, actual: actualUpdatedAt } }, { status: 409 });
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

  // 幂等：回合已完成则直接返回已存的 Markdown（仅支持流式回合）
  if (round.status === 'completed' && round.result_json) {
    try {
      const existing = JSON.parse(round.result_json);
      const reportMarkdown = typeof existing?.reportMarkdown === 'string' ? existing.reportMarkdown : '';
      if (reportMarkdown.trim()) {
        return new Response(reportMarkdown, {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    } catch {
      // fall through
    }
    return json({ error: '回合已结算（非流式战报请刷新页面查看）', code: 'ROUND_ALREADY_RESOLVED' }, { status: 409 });
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

  const choiceByUserId = new Map<number, PvpSnapshotRef>();
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
      const snap = await getPvpCardSnapshotById(choice.id);
      if (!snap) return json({ error: '快照不存在，请重试' }, { status: 409 });
      picked.push({
        userId: participant.userId,
        seat: participant.seat,
        username: participant.username,
        prefix: participant.prefix,
        token,
        snapshot: snap,
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

  const buildGuidance = () => {
    const mapping = picked.map((p) => `- ${p.token}：${p.snapshot.name}`).join('\n');
    const tokenList = picked.map((p) => `“${p.token}”`).join('、');
    return [
      '【PVP 裁判规则（流式）】',
      `本轮参战者：\n${mapping}。`,
      '你必须在“## 胜利者”板块的第一行，只写以下之一：',
      '- “平局”',
      `- 或 “胜者角色名（P1）/胜者角色名（P2）…”（括号内 token 必须严格为 ${tokenList} 之一；不得输出多个名字）。`,
      '如无把握也必须给出你认为更合理的一方，避免输出多个名字。',
      '如果你在文末追加了 MAHOSHOJO_ARENA_META 注释，请在 JSON 对象中额外加入字段 pvpWinnerToken，其值只能是上述 token 或 “平局”。',
    ].join('\n');
  };

  const upstreamRes = await fetch(new URL('/api/arena/generate-stream', origin).toString(), {
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
      })),
      selectedLevel: rules.selectedLevel,
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
      ...(rules.userGuidance?.trim() ? { userGuidance: rules.userGuidance.trim() } : {}),
      internalGuidance: buildGuidance(),
      forceStreamMeta: true,
      readArenaHistory: rules.readArenaHistory,
      ...(rules.readArenaHistory ? { arenaHistoryReadLimit: rules.isArenaHistoryUnlimited ? null : rules.readArenaHistoryLimit } : {}),
      writeArenaHistory: rules.writeArenaHistory,
      readCurrentState: rules.readCurrentState,
      writeCurrentState: rules.writeCurrentState,
      adjudicationEvents: rules.adjudicationEvents,
      ...(customProvider ? { customProvider } : {}),
      pvpContext: { roomId, matchId, roundId },
    }),
  });

  if (!upstreamRes.ok) {
    const raw = await upstreamRes.text();
    let shouldRedirect = false;
    let redirectReason: string | null = null;
    let errorMessage: string | null = null;

    if (isJsonLike(upstreamRes.headers.get('content-type'), raw)) {
      try {
        const parsed = JSON.parse(raw);
        errorMessage = typeof parsed?.error === 'string' ? parsed.error : null;
        shouldRedirect = Boolean(parsed?.shouldRedirect) || parsed?.redirect === '/arrested';
        redirectReason = typeof parsed?.reason === 'string' ? parsed.reason : null;
      } catch {
        // ignore
      }
    }

    if (shouldRedirect) {
      const report = buildPvpSensitiveArrestWarrantReport({ reason: redirectReason, roomId, matchId, roundId, issuedAt: new Date() });
      const markdown = buildMarkdownFromArrestReport(report);

      const resultJson = JSON.stringify({
        generationMode: 'stream',
        winnerUserId: null,
        winnerName: '平局',
        winnerSeat: null,
        winnerToken: null,
        winnerIsBot: null,
        winnerStatus: 'final',
        winnerVote: null,
        rawWinnerText: '平局',
        attempts: 1,
        error: null,
        combatants: picked.map((p) => ({
          token: p.token,
          userId: p.userId,
          seat: p.seat,
          isBot: Boolean(p.isBot),
          botId: p.botId ?? null,
          snapshotId: p.snapshot.id,
          name: p.snapshot.name,
          type: p.snapshot.card_type,
        })),
        reportMarkdown: markdown,
        report: report,
        updatedCombatants: [],
      });

      await updatePvpRound(roundId, { status: 'completed', resultJson, winnerUserId: null, winnerName: '平局' });

      // 等待全员确认后再推进（与非流式一致）
      const maxRounds = rules.bestOf.enabled ? rules.bestOf.maxRounds : 1;
      (internal.raw as any)._postRound = {
        roundId,
        matchId,
        roundIndex: round.round_index,
        maxRounds,
        bestOfEnabled: rules.bestOf.enabled,
        resolvedWinnerUserId: null,
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

      return new Response(markdown, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }

    await updatePvpRound(roundId, { status: 'pending' });
    await updatePvpRoomCas(roomId, resolvingVersion, { phase: 'choosing', last_activity_at: new Date().toISOString() });

    return json(
      {
        error: '战报生成失败，请稍后重试',
        code: 'BATTLE_REPORT_GENERATION_FAILED',
        detail: errorMessage || raw || 'unknown',
        attempts: 1,
      },
      { status: 502 }
    );
  }

  const upstreamBody = upstreamRes.body;
  if (!upstreamBody) {
    await updatePvpRound(roundId, { status: 'pending' });
    await updatePvpRoomCas(roomId, resolvingVersion, { phase: 'choosing', last_activity_at: new Date().toISOString() });
    return json({ error: '无法读取响应流', code: 'STREAM_BODY_MISSING' }, { status: 500 });
  }

  const candidates = picked.map((p) => ({ token: p.token, name: p.snapshot.name }));
  const metaHeader = upstreamRes.headers.get('x-mahoshojo-stream-meta');

  let streamMeta: any = null;
  if (metaHeader) {
    try {
      streamMeta = JSON.parse(decodeURIComponent(metaHeader));
    } catch {
      streamMeta = null;
    }
  }

  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let accumulatedText = '';

  const finalizeAndPersist = async (finalText: string) => {
    let winnerIndex: number | null = null;
    let isDraw = false;
    let rawWinnerText: string | null = null;
    const attempts = 1;
    let lastError: string | null = null;

    let markdownForStorage = finalText;
    const metaStripped = stripStreamUpdateMetaComment(finalText);
    if (metaStripped?.strippedMarkdown) {
      markdownForStorage = metaStripped.strippedMarkdown;
    }

    const extractedMeta = await extractStreamUpdateMeta(finalText).catch(() => null);
    const meta: any = extractedMeta?.meta ?? null;

    const candidateRawList: Array<{ raw: string | null; source: string }> = [];
    const pvpTokenFromMeta =
      (typeof meta?.pvpWinnerToken === 'string' ? meta.pvpWinnerToken : null) ||
      (typeof meta?.pvp?.winnerToken === 'string' ? meta.pvp.winnerToken : null) ||
      (typeof meta?.pvp?.winner === 'string' ? meta.pvp.winner : null) ||
      null;
    if (pvpTokenFromMeta) candidateRawList.push({ raw: pvpTokenFromMeta, source: 'meta.pvpWinnerToken' });
    const winnerFromReportMeta = typeof meta?.report?.winner === 'string' ? meta.report.winner : null;
    if (winnerFromReportMeta) candidateRawList.push({ raw: winnerFromReportMeta, source: 'meta.report.winner' });

    const winnerLine = extractWinnerLineFromMarkdown(markdownForStorage);
    if (winnerLine) candidateRawList.push({ raw: winnerLine, source: 'markdown.winner-section' });

    const regexWinner = extractWinnerFromText(markdownForStorage);
    if (regexWinner) candidateRawList.push({ raw: regexWinner, source: 'regex.winner' });

    let parsedWinner: ReturnType<typeof parsePvpWinnerFromText> | null = null;
    for (const attemptItem of candidateRawList) {
      const parsed = parsePvpWinnerFromText({ raw: attemptItem.raw, candidates, source: attemptItem.source });
      if (parsed.kind === 'invalid') continue;
      parsedWinner = parsed;
      rawWinnerText = typeof attemptItem.raw === 'string' ? attemptItem.raw : null;
      break;
    }

    if (parsedWinner?.kind === 'draw') {
      isDraw = true;
      winnerIndex = null;
    } else if (parsedWinner?.kind === 'index') {
      isDraw = false;
      winnerIndex = parsedWinner.index;
    } else {
      // 兼容旧的“按名称兜底”策略：允许唯一包含式匹配
      const byName = normalizeWinnerFromCandidates(winnerLine || winnerFromReportMeta || '', candidates.map((c) => c.name));
      if (byName.kind === 'draw') {
        isDraw = true;
        winnerIndex = null;
        rawWinnerText = winnerLine || winnerFromReportMeta || null;
      } else if (byName.kind === 'index') {
        isDraw = false;
        winnerIndex = byName.index;
        rawWinnerText = winnerLine || winnerFromReportMeta || null;
      } else {
        lastError = 'winner 不合法，无法解析';
        isDraw = false;
        winnerIndex = null;
      }
    }

    const winnerUserIdRaw = isDraw || winnerIndex === null ? null : picked[winnerIndex]!.userId;
    const shouldStartWinnerVote = !isDraw && winnerIndex === null;
    const resolvedWinnerUserId = shouldStartWinnerVote ? null : (typeof winnerUserIdRaw === 'number' ? winnerUserIdRaw : null);
    const resolvedWinnerName = shouldStartWinnerVote ? null : (isDraw || winnerIndex === null ? '平局' : picked[winnerIndex]!.snapshot.name);

    const resultJson = JSON.stringify({
      generationMode: 'stream',
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
      })),
      reportMarkdown: markdownForStorage,
      streamMeta,
      updatedCombatants: [],
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
      return;
    }

    // 等待全员确认后再推进下一回合/结束
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
  };

  const wrappedBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          const chunkText = decoder.decode(value, { stream: true });
          accumulatedText += chunkText;
          controller.enqueue(value);
        }
        accumulatedText += decoder.decode();
        await finalizeAndPersist(accumulatedText);
        controller.close();
      } catch (e) {
        try {
          await updatePvpRound(roundId, { status: 'pending' });
          await updatePvpRoomCas(roomId, resolvingVersion, { phase: 'choosing', last_activity_at: new Date().toISOString() });
        } catch {
          // ignore
        }
        controller.error(e);
      }
    },
    async cancel() {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      try {
        await updatePvpRound(roundId, { status: 'pending' });
        await updatePvpRoomCas(roomId, resolvingVersion, { phase: 'choosing', last_activity_at: new Date().toISOString() });
      } catch {
        // ignore
      }
    },
  });

  const headers = new Headers(upstreamRes.headers);
  headers.set('cache-control', 'no-store');
  if (!headers.get('content-type')) {
    headers.set('content-type', 'text/plain; charset=utf-8');
  }

  return new Response(wrappedBody, { status: 200, headers });
}

export default withPvpErrorBoundary(resolveStreamHandler);
