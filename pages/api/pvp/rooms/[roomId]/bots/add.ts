import {
  addPvpRoomPlayer,
  createBotUser,
  generateUUID,
  getPvpRoomById,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  updatePvpRoomCas,
  upsertPvpRoomBot,
  upsertPvpRoomSubmission,
} from '@/lib/d1';
import { pickBotBaseName, buildBotUsername } from '@/lib/pvp/bot/names';
import { buildBotSubmissionPayload } from '@/lib/pvp/bot/submission';
import { pickBotStrategyId } from '@/lib/pvp/bot/strategies';
import { buildCardRefKey } from '@/lib/pvp/logic';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpRoomRules, PvpSubmissionPayload } from '@/lib/pvp/types';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';

export const runtime = 'edge';

type AddBotBody = { expectedVersion?: number };

const parseRules = (rulesJson: string): PvpRoomRules | null => {
  try {
    return JSON.parse(rulesJson) as PvpRoomRules;
  } catch {
    return null;
  }
};

const parseSubmission = (raw: string): PvpSubmissionPayload | null => {
  try {
    const parsed = JSON.parse(raw) as PvpSubmissionPayload;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const pickSeat = (existingSeats: Array<number | null>, maxPlayers: number): number | null => {
  const used = new Set(existingSeats.filter((s): s is number => typeof s === 'number'));
  for (let i = 0; i < maxPlayers; i++) {
    if (!used.has(i)) return i;
  }
  return null;
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

  const rules = parseRules(room.rules_json);
  if (!rules) return json({ error: '房间规则损坏' }, { status: 500 });

  const players = await getPvpRoomPlayers(roomId);
  if (players.length >= rules.participants) return json({ error: '房间已满' }, { status: 409 });

  const seat = pickSeat(players.map((p) => p.seat), rules.participants);

  // 生成 bot 用户（用户名来自 journalists，重复则加后缀）
  let botUserId: number | null = null;
  let botUsername: string | null = null;
  for (let baseAttempt = 0; baseAttempt < 8 && !botUserId; baseAttempt++) {
    const baseName = pickBotBaseName();
    for (let suffixIndex = 0; suffixIndex < 50; suffixIndex++) {
      const username = buildBotUsername(baseName, suffixIndex);
      const email = `pvpbot+${generateUUID()}@example.invalid`;
      const authKey = `bot_${generateUUID()}`;
      const id = await createBotUser(username, email, authKey);
      if (!id) continue;
      botUserId = id;
      botUsername = username;
      break;
    }
  }

  if (!botUserId || !botUsername) {
    return json({ error: '创建机器人用户失败（用户名冲突或数据库异常）', code: 'BOT_CREATE_FAILED' }, { status: 500 });
  }

  const joinOk = await addPvpRoomPlayer(roomId, botUserId, seat);
  if (!joinOk) return json({ error: '加入房间失败', code: 'BOT_JOIN_FAILED' }, { status: 500 });

  const strategyId = pickBotStrategyId(Math.random);
  await upsertPvpRoomBot(roomId, botUserId, strategyId);

  // 自动提交卡组：优先避免与现有提交重复
  const existingSubmissions = await getPvpRoomSubmissions(roomId);
  const excludeRefKeys = new Set<string>();
  for (const row of existingSubmissions) {
    const parsed = parseSubmission(row.submission_json);
    if (!parsed) continue;
    for (const c of parsed.cards) {
      excludeRefKeys.add(buildCardRefKey(c.ref));
      if (c.ref?.kind === 'preset' && typeof c.ref.filename === 'string') {
        const filename = c.ref.filename.trim();
        if (filename && !filename.toLowerCase().endsWith('.json')) {
          excludeRefKeys.add(`preset:${filename}.json`);
        }
        if (filename && filename.toLowerCase().endsWith('.json')) {
          excludeRefKeys.add(`preset:${filename.slice(0, -5)}`);
        }
      }
    }
  }

  const origin = getRequestOrigin(req);
  const subrequestAuthHeaders = buildSubrequestAuthHeaders(req);
  const botSubmission = await buildBotSubmissionPayload({
    rules,
    origin,
    forwardHeaders: subrequestAuthHeaders,
    excludeRefKeys,
  });

  if (botSubmission.cards.length !== rules.cardsPerPlayer) {
    return json({ error: '机器人卡组构建失败（候选不足）', code: 'BOT_DECK_FAILED' }, { status: 500 });
  }

  const submissionOk = await upsertPvpRoomSubmission(roomId, botUserId, JSON.stringify(botSubmission));
  if (!submissionOk) return json({ error: '写入机器人提交失败', code: 'BOT_SUBMIT_FAILED' }, { status: 500 });

  const now = new Date().toISOString();
  const nextPlayers = await getPvpRoomPlayers(roomId);
  const shouldAdvance = room.phase === 'waiting' && nextPlayers.length >= rules.participants;
  const casOk = await updatePvpRoomCas(roomId, expectedVersion, {
    ...(shouldAdvance ? { phase: 'submitting' } : {}),
    last_activity_at: now,
  });

  return json({
    success: true,
    bot: { userId: botUserId, username: botUsername, strategyId, seat },
    advanced: shouldAdvance,
    casOk,
  });
}

export default withPvpErrorBoundary(addBotHandler);
