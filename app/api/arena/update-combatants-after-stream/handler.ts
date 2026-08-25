import { getCloudflareDrArenaGenerationService } from '@/app/api/arena/generation-runtime';
import { applyPostBattleUpdates } from '@/lib/arena/service';
import { getLogger } from '@/lib/logger';
import { verifySignature } from '@/lib/signature';
import {
  readNodeArenaGenerationReconciliation,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { getDefaultNodeD1Client } from '@mahoshojo/hosted-runtime/node-runtime/d1-client';
import { NextRequest } from 'next/server';
import { hashArenaCombatantBaseRevision } from '@mahoshojo/domain/arena-reconciliation';

const log = getLogger('api-update-combatants-stream');
const GENERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

const json = (payload: unknown, status = 200, headers?: HeadersInit): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...Object.fromEntries(new Headers(headers)),
    },
  },
);

const recordOf = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const stringOf = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

/**
 * 将浏览器本地卡片与服务器在 generation 终态冻结的 effect 对账。
 * 浏览器只拥有卡片正文；战报、impacts、写入开关与幂等状态均以服务器为准。
 */
async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const body = await req.json().catch(() => null) as unknown;
  const input = recordOf(body);
  const generationId = stringOf(input?.generationId);
  const baseRevisionHash = stringOf(input?.baseRevisionHash);
  const combatants = input?.combatants;
  if (!generationId || !GENERATION_ID_PATTERN.test(generationId)) {
    return json({ error: 'generationId 无效' }, 400);
  }
  if (!Array.isArray(combatants) || combatants.length === 0) {
    return json({ error: '缺少必需参数' }, 400);
  }
  if (!baseRevisionHash || !/^[a-f0-9]{64}$/u.test(baseRevisionHash)) {
    return json({ error: 'baseRevisionHash 无效' }, 400);
  }

  const client = getDefaultNodeD1Client();
  if (!client) {
    return json({
      code: 'ARENA_RECONCILIATION_CAPABILITY_UNAVAILABLE',
      error: 'Arena reconciliation durable capability unavailable',
    }, 503);
  }

  const ownershipRequest = new Request(req.url, {
    method: 'GET',
    headers: req.headers,
  });
  const statusResponse = await getCloudflareDrArenaGenerationService().status(
    ownershipRequest,
    { generationId },
  );
  if (!statusResponse.ok) return statusResponse;
  const generation = await statusResponse.json().catch(() => null) as { status?: unknown } | null;
  if (generation?.status !== 'completed') {
    return json({
      code: 'ARENA_RECONCILIATION_GENERATION_NOT_COMPLETED',
      error: 'Generation is not completed',
    }, 409);
  }

  try {
    const authoritative = await readNodeArenaGenerationReconciliation({ client, generationId });
    if (!authoritative) {
      return json({
        code: 'ARENA_RECONCILIATION_NOT_FOUND',
        error: 'Generation reconciliation effect not found',
      }, 409);
    }
    if (authoritative.available === false) {
      return json({
        code: 'ARENA_RECONCILIATION_MANIFEST_UNAVAILABLE',
        error: 'Generation reconciliation manifest unavailable',
      }, 409);
    }
    const expectedBaseRevisionHash = stringOf(authoritative.baseRevisionHash);
    const actualBaseRevisionHash = await hashArenaCombatantBaseRevision(combatants);
    if (
      !expectedBaseRevisionHash
      || expectedBaseRevisionHash !== baseRevisionHash
      || actualBaseRevisionHash !== baseRevisionHash
    ) {
      return json({
        code: 'ARENA_RECONCILIATION_BASE_REVISION_MISMATCH',
        error: 'Combatant base revision does not match the generation roster',
      }, 409);
    }
    const expectedRosterCount = typeof authoritative.rosterCount === 'number'
      && Number.isSafeInteger(authoritative.rosterCount)
      ? authoritative.rosterCount
      : null;
    if (expectedRosterCount === null || combatants.length !== expectedRosterCount) {
      return json({
        code: 'ARENA_RECONCILIATION_ROSTER_MISMATCH',
        error: 'Combatant roster does not match the generation roster',
      }, 409);
    }

    const verifiedCombatants = await Promise.all(combatants.map(async (value) => {
      const combatant = recordOf(value)!;
      const data = recordOf(combatant.data);
      if (combatant.isNative === true && (!data || !await verifySignature(data))) {
        log.warn('角色声称原生但签名无效，将视为非原生', {
          generationId,
          character: stringOf(data?.codename) ?? stringOf(data?.name),
        });
        return { ...combatant, isNative: false };
      }
      return combatant;
    }));

    const report = recordOf(authoritative.report);
    const impacts = Array.isArray(authoritative.impacts) ? authoritative.impacts : [];
    const scenarioAuthority = recordOf(authoritative.scenario);
    if (!report) throw new Error('ARENA_RECONCILIATION_REPORT_INVALID');

    const updatedCombatants = await applyPostBattleUpdates(
      verifiedCombatants,
      report as never,
      impacts as never,
      stringOf(authoritative.userGuidance),
      scenarioAuthority ? { title: stringOf(scenarioAuthority.title) } : null,
      {
        generationId,
        baseRevisionHash,
        scenarioNativeOverride: scenarioAuthority?.isNative === true,
        writeArenaHistory: authoritative.writeArenaHistory === true,
        writeCurrentState: authoritative.writeCurrentState === true,
      },
    );
    const result = { updatedCombatants, success: true };

    log.info(`成功更新 ${updatedCombatants.length} 个角色的数据`, { generationId });
    return json(result);
  } catch (error) {
    log.error('更新角色数据时发生错误', { error, generationId });
    return json({
      code: 'ARENA_RECONCILIATION_FAILED',
      error: '更新角色数据失败',
    }, 500);
  }
}

export const appRouteHandler = handler;
export default appRouteHandler;
