import { getBattleReportGenerationByIdLite, getBattleReportGenerationCombatantsByGenerationId, getPvpCardSnapshotById, getPvpEligibleDataCard, getPvpRoomPlayers, getPvpRoundById, getPvpRoundChoices } from '@/lib/d1';
import { json, readJson, requireAuthUser } from '@/lib/pvp/server';

export const runtime = 'edge';

type RegenerateBody = { userGuidance?: unknown };

const getGenerationIdFromUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length < 3) return null;
    // /api/me/battle-reports/:generationId/regenerate
    return parts[parts.length - 2] || null;
  } catch {
    return null;
  }
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const generationId = getGenerationIdFromUrl(req.url);
  if (!generationId) return json({ error: '缺少 generationId' }, { status: 400 });

  const record = await getBattleReportGenerationByIdLite(generationId);
  if (!record || record.user_id !== auth.user.id) return json({ error: '记录不存在' }, { status: 404 });

  const body = await readJson<RegenerateBody>(req);
  if ('response' in body) return body.response;

  const userGuidance = typeof body.data.userGuidance === 'string' ? body.data.userGuidance.trim() : '';

  const origin = new URL(req.url).origin;
  const authHeader = req.headers.get('authorization') || '';

  const mode = typeof record.mode === 'string' && record.mode ? record.mode : 'classic';
  const language = typeof record.language === 'string' && record.language ? record.language : 'zh-CN';
  const selectedLevel = typeof record.selected_level === 'string' && record.selected_level ? record.selected_level : undefined;
  const storyLength = typeof record.story_length === 'string' && record.story_length ? record.story_length : undefined;

  const buildScenarioPayload = async (): Promise<{
    scenario?: unknown;
    scenarioTitle?: string;
    scenarioSourceDataCardId?: string;
    scenarioSourceDataCardUpdatedAt?: string;
  }> => {
    if (mode !== 'scenario') return {};
    if (!record.scenario_data_card_id) return {};
    const row = await getPvpEligibleDataCard(record.scenario_data_card_id, auth.user.id);
    if (!row) return {};
    if (row.type !== 'scenario') return {};
    try {
      const scenario = JSON.parse(row.data);
      return {
        scenario,
        scenarioTitle: record.scenario_title ?? undefined,
        scenarioSourceDataCardId: record.scenario_data_card_id ?? undefined,
        scenarioSourceDataCardUpdatedAt: record.scenario_data_card_updated_at ?? undefined,
      };
    } catch {
      return {};
    }
  };

  const pvpRoomId = record.pvp_room_id;
  const pvpMatchId = record.pvp_match_id;
  const pvpRoundId = record.pvp_round_id;
  const isPvp = Boolean(pvpRoundId && pvpMatchId);

  const combatants: any[] = [];

  if (isPvp && pvpRoundId) {
    const round = await getPvpRoundById(pvpRoundId);
    if (!round) return json({ error: 'PVP 回合不存在（可能已被清理）' }, { status: 410 });

    const snapshotIdsFromResult = (() => {
      if (!round.result_json) return null;
      try {
        const parsed = JSON.parse(round.result_json);
        const list = Array.isArray(parsed?.combatants) ? parsed.combatants : null;
        if (!list) return null;
        const out = list
          .map((c: any) => ({ snapshotId: typeof c?.snapshotId === 'string' ? c.snapshotId : null, seat: typeof c?.seat === 'number' ? c.seat : null }))
          .filter((x: any) => typeof x.snapshotId === 'string');
        if (out.length <= 0) return null;
        out.sort((a: any, b: any) => (a.seat ?? 99) - (b.seat ?? 99));
        return out.map((x: any) => x.snapshotId as string);
      } catch {
        return null;
      }
    })();

    let snapshotIds: string[] = snapshotIdsFromResult ?? [];
    if (snapshotIds.length <= 0) {
      const choices = await getPvpRoundChoices(pvpRoundId);
      const choiceByUserId = new Map<number, string>();
      for (const row of choices) {
        try {
          const parsed = JSON.parse(row.choice_ref_json);
          const id = typeof parsed?.id === 'string' ? parsed.id : null;
          if (id) choiceByUserId.set(row.user_id, id);
        } catch {
          continue;
        }
      }
      const players = await getPvpRoomPlayers(round.room_id);
      const sortedPlayers = [...players].sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
      snapshotIds = sortedPlayers
        .map((p) => (typeof p.user_id === 'number' ? choiceByUserId.get(p.user_id) ?? null : null))
        .filter((id): id is string => typeof id === 'string');
    }

    if (snapshotIds.length <= 0) return json({ error: '无法重建 PVP 对战素材（可能已被清理）' }, { status: 410 });

    for (const snapshotId of snapshotIds) {
      const snap = await getPvpCardSnapshotById(snapshotId);
      if (!snap) return json({ error: 'PVP 卡快照不存在（可能已被清理）' }, { status: 410 });
      try {
        combatants.push({
          type: snap.card_type,
          data: JSON.parse(snap.data_json),
          isNative: false,
          isPreset: false,
        });
      } catch {
        return json({ error: 'PVP 卡快照内容损坏' }, { status: 500 });
      }
    }
  } else {
    const rows = await getBattleReportGenerationCombatantsByGenerationId(generationId);
    if (rows.length <= 0) return json({ error: '该记录缺少可复现素材（可能由上传 JSON / 预设角色生成）' }, { status: 409 });

    const missing: string[] = [];
    for (const row of rows) {
      if (!row.data_card_id) {
        missing.push(row.name || '(未知角色)');
        continue;
      }
      if (!row.type) {
        missing.push(row.name || '(未知角色)');
        continue;
      }
      const latest = await getPvpEligibleDataCard(row.data_card_id, auth.user.id);
      if (!latest || latest.type !== 'character') {
        missing.push(row.name || '(未知角色)');
        continue;
      }
      try {
        combatants.push({
          type: row.type,
          data: JSON.parse(latest.data),
          isNative: Boolean(row.is_native),
          isPreset: Boolean(row.is_preset),
          sourceDataCardId: row.data_card_id,
          sourceDataCardUpdatedAt: row.data_card_updated_at,
        });
      } catch {
        missing.push(row.name || '(未知角色)');
      }
    }

    if (missing.length > 0) {
      return json({ error: `该记录暂不支持重生（素材缺失或不可用）：${missing.slice(0, 6).join('、')}` }, { status: 409 });
    }
  }

  const scenarioPayload = await buildScenarioPayload();

  const res = await fetch(new URL('/api/generate-battle-story', origin).toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify({
      combatants,
      selectedLevel,
      storyLength,
      mode,
      language,
      ...(userGuidance ? { userGuidance } : {}),
      readArenaHistory: false,
      writeArenaHistory: false,
      readCurrentState: false,
      writeCurrentState: false,
      useArenaHistory: false,
      ...(scenarioPayload.scenario ? { scenario: scenarioPayload.scenario } : {}),
      ...(scenarioPayload.scenarioTitle ? { scenarioTitle: scenarioPayload.scenarioTitle } : {}),
      ...(scenarioPayload.scenarioSourceDataCardId ? { scenarioSourceDataCardId: scenarioPayload.scenarioSourceDataCardId } : {}),
      ...(scenarioPayload.scenarioSourceDataCardUpdatedAt ? { scenarioSourceDataCardUpdatedAt: scenarioPayload.scenarioSourceDataCardUpdatedAt } : {}),
      ...(isPvp && pvpRoomId && pvpMatchId && pvpRoundId
        ? { pvpContext: { roomId: pvpRoomId, matchId: pvpMatchId, roundId: pvpRoundId } }
        : {}),
    }),
  });

  const raw = await res.text();
  let payload: any = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (!res.ok) {
    return json({ error: payload?.error || '重新生成失败', generationId: payload?.generationId }, { status: res.status });
  }

  return json({ success: true, report: payload?.report, generationId: payload?.generationId });
}
