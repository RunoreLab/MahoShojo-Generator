import { createPvpRoom, getPvpEligibleScenarioDataCard } from '@/lib/database/pvp';
import { PVP_ROOM_TTL_MS } from '@/lib/pvp/constants';
import { generateSaltHex, hashJoinCode } from '@/lib/pvp/crypto';
import { parsePvpScenarioSelection } from '@/lib/pvp/scenario';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpScenarioSelection } from '@/lib/pvp/types';
import { parsePvpRules } from '@/lib/pvp/validate';
import { getScenarioPresetByFilename } from '@/lib/scenario-presets';

async function roomsHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<{ rules?: unknown; password?: string; scenario?: unknown }>(req);
  if ('response' in body) return body.response;

  const parsed = parsePvpRules(body.data.rules);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 400 });

  const rules = parsed.rules;
  const scenarioSelection: PvpScenarioSelection | null = parsePvpScenarioSelection(body.data.scenario);
  if (rules.mode === 'scenario' && !scenarioSelection) {
    return json({ error: '情景模式必须选择一个情景' }, { status: 400 });
  }

  let normalizedScenario: PvpScenarioSelection | null = null;
  if (rules.mode === 'scenario' && scenarioSelection) {
    if (scenarioSelection.kind === 'preset') {
      const preset = getScenarioPresetByFilename(scenarioSelection.filename);
      if (!preset) {
        return json({ error: '预设情景不存在或不可用', code: 'SCENARIO_PRESET_NOT_FOUND' }, { status: 400 });
      }
      normalizedScenario = {
        kind: 'preset',
        filename: preset.filename,
        name: preset.title,
      };
    } else {
      const row = await getPvpEligibleScenarioDataCard(scenarioSelection.id, auth.user.id);
      if (!row) {
        return json({ error: '情景数据卡不存在/不可用/无权访问，或未通过审查/已被封禁', code: 'SCENARIO_NOT_ELIGIBLE' }, { status: 403 });
      }
      const expectedUpdatedAt = typeof scenarioSelection.updatedAt === 'string' ? scenarioSelection.updatedAt : null;
      const actualUpdatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
      if (expectedUpdatedAt && actualUpdatedAt && expectedUpdatedAt !== actualUpdatedAt) {
        return json({ error: '情景数据卡版本已变更，请重新选择后创建房间', code: 'SCENARIO_VERSION_MISMATCH', expected: expectedUpdatedAt, actual: actualUpdatedAt }, { status: 409 });
      }

      normalizedScenario = {
        kind: 'data_card',
        id: row.id,
        updatedAt: actualUpdatedAt,
        name: typeof row.name === 'string' ? row.name : null,
        isPublic: Number(row.is_public) === 1,
        author: typeof row.username === 'string' ? row.username : null,
      };
    }
  }

  const password = typeof body.data.password === 'string' ? body.data.password.trim() : '';
  const joinCodeSalt = password ? generateSaltHex() : null;
  const joinCodeHash = password && joinCodeSalt ? await hashJoinCode(password, joinCodeSalt) : null;

  const expiresAt = new Date(Date.now() + PVP_ROOM_TTL_MS).toISOString();
  const room = await createPvpRoom({
    hostUserId: auth.user.id,
    rulesJson: JSON.stringify({
      ...rules,
      allowSpectators: true,
      allowSpectatorChat: false,
      ...(rules.mode === 'scenario' && normalizedScenario ? { _scenario: normalizedScenario } : {}),
    }),
    joinCodeHash,
    joinCodeSalt,
    expiresAt,
  });

  if (!room) return json({ error: '创建房间失败' }, { status: 500 });

  return json({ success: true, roomId: room.roomId });
}

export const appRouteHandler = withPvpErrorBoundary(roomsHandler);
export default appRouteHandler;
