import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import {
  clearPvpRoomRuntimeState,
  getPvpEligibleScenarioDataCard,
  getPvpRoomById,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  updatePvpRoomCas,
} from '@/lib/database/pvp';
import { buildBotSubmissionPayload } from '@/lib/pvp/bot/submission';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { normalizePvpRoomCardRange } from '@/lib/pvp/card-range';
import { buildCardRefKey, requiresPvpSubmissionPhase } from '@/lib/pvp/logic';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { parsePvpScenarioSelection } from '@/lib/pvp/scenario';
import { loadScenarioPresetPayload } from '@/lib/pvp/scenario-preset';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import { extractScenarioAdjudicationEvents, mergeAdjudicationEvents } from '@/lib/pvp/adjudication-events';
import { parsePvpRules } from '@/lib/pvp/validate';
import type { PvpSubmissionPayload } from '@/lib/pvp/types';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';
import { getScenarioPresetByFilename } from '@/lib/scenario-presets';

type RulesBody = { expectedVersion?: number; rules?: unknown; clearSubmissions?: boolean };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object');
const sanitizeRulesPatch = (patch: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith('_') && key !== '_scenario') continue;
    out[key] = value;
  }
  return out;
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

const parseSubmission = (raw: string): PvpSubmissionPayload | null => {
  try {
    const parsed = JSON.parse(raw) as PvpSubmissionPayload;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const sameCardRange = (a: unknown, b: unknown): boolean => {
  const na = normalizePvpRoomCardRange({ cardRange: a as any });
  const nb = normalizePvpRoomCardRange({ cardRange: b as any });
  return JSON.stringify(na) === JSON.stringify(nb);
};

async function rulesHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<RulesBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可操作' }, { status: 403 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase !== 'waiting' && room.phase !== 'submitting') {
    return json({ error: '当前阶段不允许修改规则', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const internal = internalParsed.internal;

  const patchRules = isObject(body.data.rules) ? (body.data.rules as Record<string, unknown>) : null;
  if (!patchRules) return json({ error: '缺少 rules' }, { status: 400 });

  const safePatch = sanitizeRulesPatch(patchRules);
  if ('_scenario' in safePatch && safePatch._scenario !== null && safePatch._scenario !== undefined) {
    const parsedScenario = parsePvpScenarioSelection(safePatch._scenario);
    if (!parsedScenario) return json({ error: '情景数据无效' }, { status: 400 });
    if (parsedScenario.kind === 'preset') {
      const preset = getScenarioPresetByFilename(parsedScenario.filename);
      if (!preset) {
        return json({ error: '预设情景不存在或不可用', code: 'SCENARIO_PRESET_NOT_FOUND' }, { status: 400 });
      }
      safePatch._scenario = {
        kind: 'preset',
        filename: preset.filename,
        name: preset.title,
      } as any;
    } else {
      const row = await getPvpEligibleScenarioDataCard(parsedScenario.id, auth.user.id);
      if (!row) {
        return json({ error: '情景数据卡不存在/不可用/无权访问，或未通过审查/已被封禁', code: 'SCENARIO_NOT_ELIGIBLE' }, { status: 403 });
      }
      const expectedUpdatedAt = typeof parsedScenario.updatedAt === 'string' ? parsedScenario.updatedAt : null;
      const actualUpdatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
      if (expectedUpdatedAt && actualUpdatedAt && expectedUpdatedAt !== actualUpdatedAt) {
        return json({ error: '情景数据卡版本已变更，请重新选择后保存', code: 'SCENARIO_VERSION_MISMATCH', expected: expectedUpdatedAt, actual: actualUpdatedAt }, { status: 409 });
      }
      safePatch._scenario = {
        kind: 'data_card',
        id: row.id,
        updatedAt: actualUpdatedAt,
        name: typeof row.name === 'string' ? row.name : null,
        isPublic: Number(row.is_public) === 1,
        author: typeof row.username === 'string' ? row.username : null,
      } as any;
    }
  }
  const mergedRaw = { ...(internal.raw || {}), ...safePatch } as Record<string, unknown>;
  if ('_scenario' in safePatch && safePatch._scenario === null) {
    delete (mergedRaw as any)._scenario;
  }

  const scenarioSelection = parsePvpScenarioSelection((mergedRaw as any)?._scenario);
  const scenarioKey = scenarioSelection
    ? (scenarioSelection.kind === 'preset'
        ? `preset:${scenarioSelection.filename}`
        : `${scenarioSelection.id}|${scenarioSelection.updatedAt ?? ''}`)
    : '';
  const importedFor = typeof (mergedRaw as any)?._scenarioAdjudicationImportedFor === 'string'
    ? String((mergedRaw as any)._scenarioAdjudicationImportedFor).trim()
    : '';

  // 与 /arena 逻辑保持一致：当情景卡包含 adjudicationEvents 时，将其导入判定器（并持久化到房间规则中）。
  // 为避免重复导入，使用 _scenarioAdjudicationImportedFor 标记“已导入的情景版本”。
  if (scenarioSelection && scenarioKey && importedFor !== scenarioKey) {
    try {
      let scenarioPayload: any | null = null;
      if (scenarioSelection.kind === 'preset') {
        const origin = getRequestOrigin(req);
        scenarioPayload = stripPrivateKeys(await loadScenarioPresetPayload(origin, scenarioSelection.filename));
      } else {
        const row = await getPvpEligibleScenarioDataCard(scenarioSelection.id, auth.user.id);
        if (row && typeof row.data === 'string') {
          scenarioPayload = stripPrivateKeys(JSON.parse(row.data));
        }
      }

      const scenarioEvents = extractScenarioAdjudicationEvents(scenarioPayload);
      mergedRaw.adjudicationEvents = mergeAdjudicationEvents(mergedRaw.adjudicationEvents, scenarioEvents);
      (mergedRaw as any)._scenarioAdjudicationImportedFor = scenarioKey;
    } catch {
      // ignore：解析失败则不导入（但也不写入标记，避免吞掉未来修复机会）
    }
  }
  if (!scenarioSelection && (mergedRaw as any)?._scenarioAdjudicationImportedFor) {
    delete (mergedRaw as any)._scenarioAdjudicationImportedFor;
  }

  const parsed = parsePvpRules(mergedRaw);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 400 });
  const nextRules = parsed.rules;

  const players = await getPvpRoomPlayers(roomId);
  const participantCount = players.length + internal.bots.length;
  if (participantCount > nextRules.participants) {
    return json({ error: '当前房间人数已超过新规则人数，请先踢出/移除机器人', code: 'PARTICIPANTS_TOO_MANY' }, { status: 409 });
  }
  if (players.some((p) => typeof p.seat === 'number' && p.seat >= nextRules.participants)) {
    return json({ error: '已有玩家座位超出新规则人数范围，请先踢出对应玩家', code: 'SEAT_OUT_OF_RANGE' }, { status: 409 });
  }
  if (internal.bots.some((b) => b.seat >= nextRules.participants)) {
    return json({ error: '已有机器人座位超出新规则人数范围，请先移除对应机器人', code: 'SEAT_OUT_OF_RANGE' }, { status: 409 });
  }

  const before = internal.rules;
  const changedCardsPerPlayer = before.cardsPerPlayer !== nextRules.cardsPerPlayer;
  const changedSubmissionMode = before.submissionMode !== nextRules.submissionMode;
  const changedCardRange = !sameCardRange(before.cardRange, nextRules.cardRange);

  const shouldClear = Boolean(body.data.clearSubmissions);
  const willInvalidateSubmissions = changedCardsPerPlayer || changedSubmissionMode || changedCardRange;
  if (room.phase === 'submitting' && willInvalidateSubmissions) {
    const subs = await getPvpRoomSubmissions(roomId);
    if (subs.length > 0 && !shouldClear) {
      const hint = changedSubmissionMode
        ? '修改提交模式会清空已提交卡组'
        : changedCardsPerPlayer
          ? '修改每人提交数量会清空已提交卡组'
          : '修改卡牌范围会清空已提交卡组';
      return json({ error: `${hint}，请确认后再保存`, code: 'NEED_CLEAR_SUBMISSIONS' }, { status: 409 });
    }
    if (subs.length > 0 && shouldClear) {
      const cleared = await clearPvpRoomRuntimeState(roomId);
      if (!cleared) return json({ error: '清理已提交卡组失败，请稍后重试', code: 'CLEAR_FAILED' }, { status: 500 });
    }
  }

  // 若“卡牌范围”变更，重建现有 Bot 的提交卡组，避免出现“Bot 仍持有旧范围卡牌”的不一致。
  if (changedCardRange && internal.bots.length > 0 && nextRules.submissionMode !== 'hostOnly' && nextRules.cardsPerPlayer > 0) {
    const origin = getRequestOrigin(req);
    const forwardHeaders = buildSubrequestAuthHeaders(req);
    const existingSubmissions = await getPvpRoomSubmissions(roomId);
    const excludeRefKeys = new Set<string>();

    for (const row of existingSubmissions) {
      const parsed = parseSubmission(row.submission_json);
      if (!parsed) continue;
      for (const c of parsed.cards) {
        excludeRefKeys.add(buildCardRefKey(c.ref));
      }
    }

    for (const bot of internal.bots) {
      const submission = await buildBotSubmissionPayload({
        rules: nextRules,
        origin,
        forwardHeaders,
        excludeRefKeys,
      });

      if (submission.cards.length !== nextRules.cardsPerPlayer) {
        return json({ error: '机器人卡组重建失败：当前卡牌范围过窄或候选不足，请放宽范围或移除机器人', code: 'BOT_REBUILD_FAILED' }, { status: 409 });
      }

      bot.submission = submission;
      for (const c of submission.cards) excludeRefKeys.add(buildCardRefKey(c.ref));
    }
  }

  internal.rules = { ...nextRules };
  internal.raw = mergedRaw;
  const nextPhase =
    participantCount >= nextRules.participants
      ? (requiresPvpSubmissionPhase(nextRules) ? 'submitting' : 'waiting')
      : 'waiting';

  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    phase: nextPhase,
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: new Date().toISOString(),
  });

  if (!ok) return json({ error: '更新失败', code: 'UPDATE_FAILED' }, { status: 409 });
  return json({ success: true, phase: nextPhase, rules: nextRules, cleared: shouldClear && willInvalidateSubmissions });
}

export default withPagesApiResponse(withPvpErrorBoundary(rulesHandler));

