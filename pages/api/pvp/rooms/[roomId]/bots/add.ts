import { getPvpRoomById, getPvpRoomPlayers, getPvpRoomSubmissions, updatePvpRoomCas } from '@/lib/d1';
import { pickBotBaseName, buildBotUsername } from '@/lib/pvp/bot/names';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { buildBotSubmissionPayload } from '@/lib/pvp/bot/submission';
import { pickBotStrategyId } from '@/lib/pvp/bot/strategies';
import { buildCardRefKey, requiresPvpSubmissionPhase } from '@/lib/pvp/logic';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpSubmissionPayload } from '@/lib/pvp/types';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';

export const runtime = 'edge';

type AddBotBody = { expectedVersion?: number };

const parseSubmission = (raw: string): PvpSubmissionPayload | null => {
  try {
    const parsed = JSON.parse(raw) as PvpSubmissionPayload;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const pickSeat = (usedSeats: Array<number | null>, maxPlayers: number): number | null => {
  const used = new Set(usedSeats.filter((s): s is number => typeof s === 'number'));
  for (let i = 0; i < maxPlayers; i++) {
    if (!used.has(i)) return i;
  }
  return null;
};

const buildPresetKeyVariants = (filename: string): string[] => {
  const raw = typeof filename === 'string' ? filename.trim() : '';
  if (!raw) return [];
  const lower = raw.toLowerCase();
  if (lower.endsWith('.json')) return [`preset:${raw}`, `preset:${raw.slice(0, -5)}`];
  return [`preset:${raw}`, `preset:${raw}.json`];
};

async function addBotHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<AddBotBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可添加机器人', code: 'HOST_ONLY' }, { status: 403 });
  if (room.status !== 'open' || room.phase === 'closed') return json({ error: '房间已关闭' }, { status: 410 });
  if (room.phase !== 'waiting' && room.phase !== 'submitting') {
    return json({ error: '当前阶段不允许添加机器人', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const parsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 500 });
  const internal = parsed.internal;

  const players = await getPvpRoomPlayers(roomId);
  const totalBefore = players.length + internal.bots.length;
  if (totalBefore >= internal.rules.participants) return json({ error: '房间已满' }, { status: 409 });

  const seat = pickSeat(
    [...players.map((p) => p.seat), ...internal.bots.map((b) => b.seat)],
    internal.rules.participants
  );
  if (seat === null) return json({ error: '无法分配座位（房间已满）' }, { status: 409 });

  const existingNames = new Set<string>([
    ...players.map((p) => (typeof p.username === 'string' ? p.username.trim() : '')).filter(Boolean),
    ...internal.bots.map((b) => b.name),
  ]);

  let botName: string | null = null;
  for (let baseAttempt = 0; baseAttempt < 8 && !botName; baseAttempt++) {
    const base = pickBotBaseName();
    for (let suffixIndex = 0; suffixIndex < 50; suffixIndex++) {
      const candidate = buildBotUsername(base, suffixIndex);
      if (!existingNames.has(candidate)) {
        botName = candidate;
        break;
      }
    }
  }
  if (!botName) return json({ error: '生成机器人名称失败', code: 'BOT_NAME_FAILED' }, { status: 500 });

  const strategyId = pickBotStrategyId(Math.random);

  const existingSubmissions = await getPvpRoomSubmissions(roomId);
  const excludeRefKeys = new Set<string>();

  // 现有真人提交
  for (const row of existingSubmissions) {
    const parsed = parseSubmission(row.submission_json);
    if (!parsed) continue;
    for (const c of parsed.cards) {
      excludeRefKeys.add(buildCardRefKey(c.ref));
      if (c.ref?.kind === 'preset') {
        for (const k of buildPresetKeyVariants(c.ref.filename)) excludeRefKeys.add(k);
      }
    }
  }

  // 现有 Bot 提交
  for (const bot of internal.bots) {
    for (const c of bot.submission.cards) {
      excludeRefKeys.add(buildCardRefKey(c.ref));
      if (c.ref?.kind === 'preset') {
        for (const k of buildPresetKeyVariants(c.ref.filename)) excludeRefKeys.add(k);
      }
    }
  }

  const origin = getRequestOrigin(req);
  const subrequestAuthHeaders = buildSubrequestAuthHeaders(req);
  const submission = await buildBotSubmissionPayload({
    rules: internal.rules,
    origin,
    forwardHeaders: subrequestAuthHeaders,
    excludeRefKeys,
  });

  if (submission.cards.length !== internal.rules.cardsPerPlayer) {
    return json({ error: '机器人卡组构建失败（候选不足）', code: 'BOT_DECK_FAILED' }, { status: 409 });
  }

  const botId = `bot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  internal.bots.push({
    id: botId,
    name: botName,
    seat,
    strategyId,
    submission,
  });

  const totalAfter = players.length + internal.bots.length;
  const shouldAdvance =
    room.phase === 'waiting' &&
    requiresPvpSubmissionPhase(internal.rules) &&
    totalAfter >= internal.rules.participants;

  const now = new Date().toISOString();
  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    rules_json: stringifyPvpRoomInternalState(internal),
    ...(shouldAdvance ? { phase: 'submitting' } : {}),
    last_activity_at: now,
  });

  if (!ok) return json({ error: '添加失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  return json({
    success: true,
    bot: { id: botId, name: botName, seat, strategyId },
    advanced: shouldAdvance,
    nextVersion: expectedVersion + 1,
  });
}

export default withPvpErrorBoundary(addBotHandler);
