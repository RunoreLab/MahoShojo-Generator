import { getPvpEligibleDataCard, getPvpRoomById, getPvpRoomPlayers, updatePvpRoomCas, upsertPvpRoomSubmission } from '@/lib/database/pvp';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { describePvpRoomCardRange, isPvpCombatantTypeAllowedByRange, isPvpDataCardStatsAllowedByRange, normalizePvpRoomCardRange } from '@/lib/pvp/card-range';
import { inferPvpCombatantTypeFromJson } from '@/lib/pvp/logic';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { loadPresetCard } from '@/lib/pvp/preset';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpDataCardRef, PvpPresetRef, PvpRoomRules, PvpSubmissionPayload, PvpSubmittedCard } from '@/lib/pvp/types';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';

const parseRules = (rulesJson: string): PvpRoomRules | null => {
  try {
    return JSON.parse(rulesJson) as PvpRoomRules;
  } catch {
    return null;
  }
};

type SubmitBody = {
  expectedVersion?: number;
  cards?: Array<{ kind: 'data_card'; id: string; updatedAt?: string | null } | { kind: 'preset'; filename: string }>;
  acceptPrivateDisclosure?: boolean;
};

async function submitHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<SubmitBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.status !== 'open') return json({ error: '房间已关闭' }, { status: 410 });
  if (room.phase !== 'submitting') return json({ error: '当前阶段不允许提交卡组', code: 'PHASE_FORBIDDEN' }, { status: 409 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const rules = parseRules(room.rules_json);
  if (!rules) return json({ error: '房间规则损坏' }, { status: 500 });
  const cardRange = normalizePvpRoomCardRange(rules);

  const players = await getPvpRoomPlayers(roomId);
  if (!players.some((p) => p.user_id === auth.user.id)) return json({ error: '你不在该房间中' }, { status: 403 });

  const cards = Array.isArray(body.data.cards) ? body.data.cards : null;
  if (!cards) return json({ error: '缺少 cards' }, { status: 400 });
  if (rules.submissionMode === 'hostOnly') {
    if (auth.user.id !== room.host_user_id) {
      return json({ error: '当前房间为“仅房主提交牌堆”模式，只有房主可以提交', code: 'HOST_ONLY_DECK' }, { status: 403 });
    }
    if (cards.length <= 0) return json({ error: '房主提交的牌堆至少需要 1 张卡' }, { status: 400 });
    if (cards.length > 500) return json({ error: '提交卡牌过多（最多 500 张）', code: 'TOO_MANY_CARDS' }, { status: 413 });
  } else {
    if (cards.length !== rules.cardsPerPlayer) return json({ error: `需要提交 ${rules.cardsPerPlayer} 张卡` }, { status: 400 });
  }

  const origin = getRequestOrigin(req);
  const subrequestAuthHeaders = buildSubrequestAuthHeaders(req);

  const submittedCards: PvpSubmittedCard[] = [];
  let hasPrivateCard = false;
  const sensitiveChunks: string[] = [];

  for (const rawRef of cards) {
    if (rawRef.kind === 'data_card') {
      const id = typeof rawRef.id === 'string' ? rawRef.id.trim() : '';
      if (!id) return json({ error: 'data_card.id 不能为空' }, { status: 400 });

      const row = await getPvpEligibleDataCard(id, auth.user.id);
      if (!row) return json({ error: '数据卡不存在/不可用/无权访问', code: 'CARD_NOT_ELIGIBLE' }, { status: 403 });

      const expectedUpdatedAt = typeof rawRef.updatedAt === 'string' ? rawRef.updatedAt : null;
      const actualUpdatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
      if (expectedUpdatedAt && actualUpdatedAt && expectedUpdatedAt !== actualUpdatedAt) {
        return json({ error: '数据卡版本已变更，请重新选择后提交', code: 'CARD_VERSION_MISMATCH', expected: expectedUpdatedAt, actual: actualUpdatedAt }, { status: 409 });
      }

      const dataJson = row.data;
      let parsedData: any;
      try {
        parsedData = JSON.parse(dataJson);
      } catch {
        return json({ error: '数据卡内容损坏（不是有效 JSON）', code: 'CARD_JSON_INVALID' }, { status: 500 });
      }

      const type = inferPvpCombatantTypeFromJson(parsedData);
      if (!isPvpCombatantTypeAllowedByRange(type, cardRange)) {
        return json(
          { error: `该房间禁止提交此类型卡牌（${type}）。当前范围：${describePvpRoomCardRange(cardRange)}`, code: 'CARD_TYPE_FORBIDDEN' },
          { status: 403 }
        );
      }

      const likeCount = Number.isFinite((row as any).like_count) ? Number((row as any).like_count) : null;
      const usageCount = Number.isFinite((row as any).usage_count) ? Number((row as any).usage_count) : null;
      const favoriteCount = Number.isFinite((row as any).favorite_count) ? Number((row as any).favorite_count) : null;
      if (!isPvpDataCardStatsAllowedByRange({ likeCount, usageCount, favoriteCount }, cardRange)) {
        return json(
          { error: `该房间的卡牌范围限制了此数据卡的统计值。当前范围：${describePvpRoomCardRange(cardRange)}`, code: 'CARD_STATS_FORBIDDEN' },
          { status: 403 }
        );
      }

      const isPublic = Number(row.is_public) === 1;
      if (!isPublic) hasPrivateCard = true;

      submittedCards.push({
        ref: { kind: 'data_card', id, updatedAt: actualUpdatedAt } satisfies PvpDataCardRef,
        name: row.name,
        type,
        dataJson,
        source: {
          isPublic,
          authorUsername: row.username,
        },
      });
      sensitiveChunks.push(row.name, row.description || '', dataJson);
      continue;
    }

    if (rawRef.kind === 'preset') {
      const filename = typeof rawRef.filename === 'string' ? rawRef.filename.trim() : '';
      if (!filename) return json({ error: 'preset.filename 不能为空' }, { status: 400 });
      let preset: Awaited<ReturnType<typeof loadPresetCard>>;
      try {
        preset = await loadPresetCard(origin, filename, subrequestAuthHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : '无法读取预设卡';
        const statusMatch = message.match(/HTTP\s+(\d{3})/i);
        const statusFromMessage = statusMatch ? Number(statusMatch[1]) : null;
        const status =
          typeof statusFromMessage === 'number' && Number.isFinite(statusFromMessage) && statusFromMessage >= 400 && statusFromMessage < 500
            ? statusFromMessage
            : 500;
        return json({ error: message, code: 'PRESET_LOAD_FAILED' }, { status });
      }
      if (!isPvpCombatantTypeAllowedByRange(preset.type, cardRange)) {
        return json(
          { error: `该房间禁止提交此类型预设卡（${preset.type}）。当前范围：${describePvpRoomCardRange(cardRange)}`, code: 'CARD_TYPE_FORBIDDEN' },
          { status: 403 }
        );
      }
      submittedCards.push({
        ref: { kind: 'preset', filename } satisfies PvpPresetRef,
        name: preset.name,
        type: preset.type,
        dataJson: preset.dataJson,
        source: { isPublic: true },
      });
      sensitiveChunks.push(preset.name, preset.dataJson);
      continue;
    }

    return json({ error: '未知的卡引用 kind' }, { status: 400 });
  }

  if (hasPrivateCard && body.data.acceptPrivateDisclosure !== true) {
    return json({ error: '包含私有卡时必须确认披露条款', code: 'PRIVACY_ACK_REQUIRED' }, { status: 400 });
  }

  const sensitiveText = sensitiveChunks.join('\n\n');
  if (sensitiveText) {
    const check = await quickCheck(sensitiveText);
    if (check.hasSensitiveWords) {
      return json({ error: '输入内容不合规', code: 'SENSITIVE_WORD_DETECTED' }, { status: 403 });
    }
  }

  const submission: PvpSubmissionPayload = {
    cards: submittedCards,
    hasPrivateCard,
  };

  const ok = await upsertPvpRoomSubmission(roomId, auth.user.id, JSON.stringify(submission));
  if (!ok) return json({ error: '提交失败' }, { status: 500 });

  const casOk = await updatePvpRoomCas(roomId, expectedVersion, { last_activity_at: new Date().toISOString() });
  if (!casOk) {
    return json({ success: true, submitted: true, warning: '提交成功，但房间状态版本更新失败，请刷新' });
  }

  return json({ success: true, submitted: true, nextVersion: expectedVersion + 1 });
}

export default withPvpErrorBoundary(submitHandler);
