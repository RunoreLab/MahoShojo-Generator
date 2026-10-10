import { resolveCloudflareDrArenaGenerationActor } from '@/app/api/arena/generation-runtime';
import { getNextHostedD1Client } from '@/lib/hosted-dr/database-provider';
import { applyPostBattleUpdates } from '@/lib/arena/service';
import { getLogger } from '@/lib/logger';
import { generateSignature, verifySignature } from '@/lib/signature';
import {
  ARENA_RECONCILIATION_CAPABILITY,
  ARENA_RECONCILIATION_LIMITS,
  ARENA_RECONCILIATION_PROTOCOL_HEADER,
  ARENA_RECONCILIATION_PROTOCOL_VERSION,
  ArenaReconciliationRequestSchema,
  parseArenaReconciliationResponse,
} from '@mahoshojo/contracts/arena-reconciliation';
import {
  ARENA_EXPECTED_USER_ID_HEADER,
  parseArenaExpectedUserIdAssertion,
} from '@mahoshojo/contracts/desktop-arena-hosted';
import {
  ARENA_ANONYMOUS_TOKEN_HEADER,
  isCanonicalArenaCharacterPreset,
  readOwnedNodeArenaGenerationReconciliation,
  resolveArenaCombatantNativeAuthority,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { NextRequest } from 'next/server';

const log = getLogger('api-update-combatants-stream');
const GENERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const protocolHeaders = { [ARENA_RECONCILIATION_PROTOCOL_HEADER]: ARENA_RECONCILIATION_PROTOCOL_VERSION };

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

const integerOf = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null
);

const nameToken = (value: string | null): string => (
  value?.replace(/\s+/gu, '').toLocaleLowerCase() ?? ''
);

type CombatantIdentity = Readonly<{
  position: number;
  sortIndex: number;
  roomCombatantKey: string | null;
  dataCardIds: ReadonlySet<string>;
  presetTemplates: ReadonlySet<string>;
  isPreset: boolean;
  name: string | null;
  type: string | null;
  native: boolean;
  nativeSignature: string | null;
  characterGuidance: string | null;
  value: Record<string, unknown>;
}>;

const stringSet = (...values: unknown[]): ReadonlySet<string> => new Set(
  values.flatMap((value) => stringOf(value) ? [stringOf(value)!] : []),
);

const currentIdentity = (value: unknown, position: number): CombatantIdentity | null => {
  const combatant = recordOf(value);
  const data = recordOf(combatant?.data);
  if (!combatant || !data) return null;
  return {
    position,
    sortIndex: position,
    roomCombatantKey: stringOf(combatant.roomCombatantKey)
      ?? stringOf(combatant.arenaRoomKey),
    dataCardIds: stringSet(
      combatant.sourceDataCardId,
      combatant.dataCardId,
    ),
    presetTemplates: stringSet(combatant.filename, combatant.templateId, data.templateId),
    isPreset: combatant.isPreset === true,
    name: stringOf(data.codename) ?? stringOf(data.name),
    type: stringOf(combatant.type),
    native: false,
    nativeSignature: null,
    characterGuidance: null,
    value: combatant,
  };
};

const rosterIdentity = (value: unknown, position: number): CombatantIdentity | null => {
  const combatant = recordOf(value);
  if (!combatant) return null;
  return {
    position,
    sortIndex: integerOf(combatant.sortIndex) ?? position,
    roomCombatantKey: stringOf(combatant.roomCombatantKey),
    dataCardIds: stringSet(combatant.dataCardId, combatant.sourceDataCardId),
    presetTemplates: stringSet(combatant.templateId, combatant.filename),
    isPreset: combatant.isPreset === true,
    name: stringOf(combatant.name),
    type: stringOf(combatant.type),
    native: combatant.isNative === true,
    nativeSignature: stringOf(combatant.nativeSignature),
    characterGuidance: stringOf(combatant.characterGuidance),
    value: combatant,
  };
};

const setsIntersect = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => (
  [...left].some((value) => right.has(value))
);

type CombatantMatch = Readonly<{
  current: CombatantIdentity;
  roster: CombatantIdentity;
}>;

const matchCombatants = (
  currentValues: readonly unknown[],
  rosterValues: readonly unknown[],
): Readonly<{
  matches: CombatantMatch[];
  unmatchedCurrentIndexes: number[];
  unmatchedRoster: CombatantIdentity[];
}> => {
  const current = currentValues.flatMap((value, index) => {
    const identity = currentIdentity(value, index);
    return identity ? [identity] : [];
  });
  const roster = rosterValues.flatMap((value, index) => {
    const identity = rosterIdentity(value, index);
    return identity ? [identity] : [];
  });
  const unmatchedCurrent = new Set(current.map((identity) => identity.position));
  const unmatchedRoster = new Set(roster.map((identity) => identity.position));
  const matches: CombatantMatch[] = [];

  const assignBidirectionallyUnique = (
    predicate: (candidate: CombatantIdentity, frozen: CombatantIdentity) => boolean,
  ): void => {
    const pairs = current.flatMap((candidate) => {
      if (!unmatchedCurrent.has(candidate.position)) return [];
      return roster.flatMap((frozen) => (
        unmatchedRoster.has(frozen.position) && predicate(candidate, frozen)
          ? [{ candidate, frozen }]
          : []
      ));
    });
    const currentCounts = new Map<number, number>();
    const rosterCounts = new Map<number, number>();
    for (const pair of pairs) {
      currentCounts.set(pair.candidate.position, (currentCounts.get(pair.candidate.position) ?? 0) + 1);
      rosterCounts.set(pair.frozen.position, (rosterCounts.get(pair.frozen.position) ?? 0) + 1);
    }
    for (const { candidate, frozen } of pairs) {
      if (currentCounts.get(candidate.position) !== 1 || rosterCounts.get(frozen.position) !== 1) {
        continue;
      }
      unmatchedCurrent.delete(candidate.position);
      unmatchedRoster.delete(frozen.position);
      matches.push({ current: candidate, roster: frozen });
    }
  };

  assignBidirectionallyUnique((candidate, frozen) => Boolean(
    candidate.roomCombatantKey
      && frozen.roomCombatantKey
      && candidate.roomCombatantKey === frozen.roomCombatantKey,
  ));
  assignBidirectionallyUnique((candidate, frozen) => (
    candidate.dataCardIds.size > 0
      && frozen.dataCardIds.size > 0
      && setsIntersect(candidate.dataCardIds, frozen.dataCardIds)
  ));
  assignBidirectionallyUnique((candidate, frozen) => (
    candidate.isPreset
      && frozen.isPreset
      && candidate.presetTemplates.size > 0
      && frozen.presetTemplates.size > 0
      && setsIntersect(candidate.presetTemplates, frozen.presetTemplates)
  ));

  const identityKey = (identity: CombatantIdentity): string | null => {
    const normalizedName = nameToken(identity.name);
    return normalizedName && identity.type ? `${identity.type}\u0000${normalizedName}` : null;
  };
  const currentCounts = new Map<string, number>();
  const rosterCounts = new Map<string, number>();
  for (const identity of current) {
    if (!unmatchedCurrent.has(identity.position)) continue;
    const key = identityKey(identity);
    if (key) currentCounts.set(key, (currentCounts.get(key) ?? 0) + 1);
  }
  for (const identity of roster) {
    if (!unmatchedRoster.has(identity.position)) continue;
    const key = identityKey(identity);
    if (key) rosterCounts.set(key, (rosterCounts.get(key) ?? 0) + 1);
  }
  const hasStableClaim = (identity: CombatantIdentity): boolean => Boolean(
    identity.roomCombatantKey
      || identity.dataCardIds.size > 0
      || (identity.isPreset && identity.presetTemplates.size > 0),
  );
  assignBidirectionallyUnique((candidate, frozen) => {
    const key = identityKey(candidate);
    return Boolean(
      key
      && !hasStableClaim(candidate)
      && !hasStableClaim(frozen)
      && key === identityKey(frozen)
      && currentCounts.get(key) === 1
      && rosterCounts.get(key) === 1,
    );
  });

  const invalidCurrentIndexes = currentValues.flatMap((_, index) => (
    current.some((identity) => identity.position === index) ? [] : [index]
  ));
  return {
    matches: matches.sort((left, right) => left.current.position - right.current.position),
    unmatchedCurrentIndexes: [...unmatchedCurrent, ...invalidCurrentIndexes]
      .sort((left, right) => left - right),
    unmatchedRoster: roster
      .filter((identity) => unmatchedRoster.has(identity.position))
      .sort((left, right) => left.sortIndex - right.sortIndex),
  };
};

/** Check this Next runtime only. This does not prove Hono/Next D1 contents or keys agree. */
const hasReconciliationCapability = async (): Promise<boolean> => {
  try {
    return Boolean(getNextHostedD1Client()
      && process.env.SIGNATURE_SECRET_KEY?.trim()
      && await generateSignature({ purpose: 'arena-reconciliation-capability-v1' }));
  } catch {
    return false;
  }
};

const readBoundedReconciliationBody = async (request: Request): Promise<unknown> => {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > ARENA_RECONCILIATION_LIMITS.requestBodyBytes) {
    throw new Error('ARENA_RECONCILIATION_REQUEST_TOO_LARGE');
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > ARENA_RECONCILIATION_LIMITS.requestBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('ARENA_RECONCILIATION_REQUEST_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
};

/**
 * 将浏览器当前本地卡片与服务器冻结的 roster identity / effect 对账。
 * 客户端卡片正文与 isNative 都不是许可；服务器只保留 generation owner、终态和 effect 权威。
 */
async function handler(req: NextRequest): Promise<Response> {
  if (req.method === 'GET') {
    return await hasReconciliationCapability()
      ? json(ARENA_RECONCILIATION_CAPABILITY, 200, protocolHeaders)
      : json({
        code: 'ARENA_RECONCILIATION_CAPABILITY_UNAVAILABLE',
        error: 'Arena reconciliation durable or signing capability unavailable',
      }, 503, protocolHeaders);
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const protocol = req.headers.get(ARENA_RECONCILIATION_PROTOCOL_HEADER);
  const optIn = protocol !== null;
  let generationId: string | null = null;
  let combatantCount = 0;
  const respond = (payload: Record<string, unknown>, status = 200): Response => {
    if (!optIn) return json(payload, status);
    const envelope = {
      version: ARENA_RECONCILIATION_PROTOCOL_VERSION,
      ...(generationId && GENERATION_ID_PATTERN.test(generationId) ? { generationId } : {}),
      ...(status >= 400 && !payload.code ? { code: 'ARENA_RECONCILIATION_INVALID_REQUEST' } : {}),
      ...payload,
    };
    const raw = JSON.stringify(envelope);
    if (new TextEncoder().encode(raw).byteLength > ARENA_RECONCILIATION_LIMITS.responseBodyBytes) {
      return json({
        version: ARENA_RECONCILIATION_PROTOCOL_VERSION,
        ...(generationId ? { generationId } : {}),
        code: 'ARENA_RECONCILIATION_RESPONSE_TOO_LARGE',
        error: '角色更新超过接收预算，战报与原卡保留；请勿重新生成。',
      }, 503, protocolHeaders);
    }
    if (status < 400) parseArenaReconciliationResponse(raw, generationId!, combatantCount);
    return json(envelope, status, protocolHeaders);
  };
  if (optIn && protocol !== ARENA_RECONCILIATION_PROTOCOL_VERSION) {
    return respond({
      code: 'ARENA_RECONCILIATION_PROTOCOL_UNSUPPORTED',
      error: 'Unsupported Arena reconciliation protocol',
    }, 409);
  }
  if (optIn && !await hasReconciliationCapability()) {
    return respond({
      code: 'ARENA_RECONCILIATION_CAPABILITY_UNAVAILABLE',
      error: 'Arena reconciliation durable or signing capability unavailable',
    }, 503);
  }

  let body: unknown;
  try {
    body = optIn ? await readBoundedReconciliationBody(req) : await req.json();
  } catch (error) {
    if (optIn && error instanceof Error && error.message === 'ARENA_RECONCILIATION_REQUEST_TOO_LARGE') {
      return respond({ code: error.message, error: 'Arena reconciliation request exceeds the input budget' }, 413);
    }
    body = null;
  }
  const input = recordOf(body);
  generationId = stringOf(input?.generationId);
  const combatants = input?.combatants;
  if (optIn && !ArenaReconciliationRequestSchema.safeParse(body).success) {
    return respond({ error: 'Arena reconciliation request is invalid' }, 400);
  }
  combatantCount = Array.isArray(combatants) ? combatants.length : 0;
  if (!generationId || !GENERATION_ID_PATTERN.test(generationId)) {
    return respond({ error: 'generationId 无效' }, 400);
  }
  if (!Array.isArray(combatants) || combatants.length === 0) {
    return respond({ error: '缺少必需参数' }, 400);
  }

  const client = getNextHostedD1Client();
  if (!client) {
    return respond({
      code: 'ARENA_RECONCILIATION_CAPABILITY_UNAVAILABLE',
      error: 'Arena reconciliation durable capability unavailable',
    }, 503);
  }

  const expectedUserAssertion = req.headers.get(ARENA_EXPECTED_USER_ID_HEADER);
  const expectedUserId = expectedUserAssertion === null ? null : parseArenaExpectedUserIdAssertion(expectedUserAssertion);
  if (optIn) {
    const originalActorToken = req.headers.get(ARENA_ANONYMOUS_TOKEN_HEADER)?.trim() ?? '';
    if (expectedUserAssertion !== null ? expectedUserId === null : !/^[A-Za-z0-9_-]+$/u.test(originalActorToken)) {
      return respond({ code: 'UNAUTHORIZED', error: 'Original generation actor credential required' }, 401);
    }
  }

  let actor: Awaited<ReturnType<typeof resolveCloudflareDrArenaGenerationActor>>;
  try {
    actor = await resolveCloudflareDrArenaGenerationActor(req);
  } catch {
    log.error('解析 Arena reconciliation actor 失败', { generationId });
    return respond({
      code: 'ARENA_RECONCILIATION_ACTOR_UNAVAILABLE',
      error: 'Arena reconciliation actor unavailable',
    }, 503);
  }
  if (!actor) return respond({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);
  if (optIn && (expectedUserId !== null
    ? actor.actorKey !== `user:${expectedUserId}`
    : !actor.actorKey.startsWith('anonymous:') || new Headers(actor.responseHeaders).has(ARENA_ANONYMOUS_TOKEN_HEADER))) {
    return respond({ code: 'UNAUTHORIZED', error: 'Original generation actor does not match' }, 401);
  }

  let ownedReconciliation: Awaited<ReturnType<typeof readOwnedNodeArenaGenerationReconciliation>>;
  try {
    ownedReconciliation = await readOwnedNodeArenaGenerationReconciliation({
      client,
      generationId,
      actorKey: actor.actorKey,
    });
  } catch {
    log.error('读取 Arena reconciliation durable authority 失败', { generationId });
    return respond({
      code: 'ARENA_RECONCILIATION_DURABLE_READ_FAILED',
      error: 'Arena reconciliation durable authority unavailable',
    }, 503);
  }
  if (ownedReconciliation.kind === 'not-found') {
    return respond({
      code: 'ARENA_RECONCILIATION_NOT_FOUND',
      error: 'Generation reconciliation not found',
    }, 404);
  }
  if (ownedReconciliation.kind === 'unavailable') {
    if (ownedReconciliation.reason === 'generation_not_completed') {
      return respond({
        code: 'ARENA_RECONCILIATION_GENERATION_NOT_COMPLETED',
        error: 'Generation is not completed',
      }, 409);
    }
    if (ownedReconciliation.reason === 'finalization_pending') {
      return respond({
        code: 'ARENA_RECONCILIATION_FINALIZATION_PENDING',
        error: 'Generation reconciliation finalization remains pending',
      }, 503);
    }
    return respond({
      code: 'ARENA_RECONCILIATION_MANIFEST_UNAVAILABLE',
      error: 'Generation reconciliation manifest unavailable',
    }, 409);
  }

  try {
    const authoritative = ownedReconciliation.reconciliation;
    if (authoritative.available === false) {
      return respond({
        code: 'ARENA_RECONCILIATION_MANIFEST_UNAVAILABLE',
        error: 'Generation reconciliation manifest unavailable',
      }, 409);
    }
    const roster = Array.isArray(authoritative.roster) ? authoritative.roster : [];
    const reconciliation = matchCombatants(combatants, roster);
    const unmatchedCurrent = reconciliation.unmatchedCurrentIndexes.map((combatantIndex) => ({
      combatantIndex,
      code: 'ARENA_RECONCILIATION_COMBATANT_UNMATCHED',
      message: '当前角色无法与本次 generation roster 可信对应，已跳过。',
    }));
    const unmatchedRoster = reconciliation.unmatchedRoster.map((identity) => ({
      rosterIndex: identity.sortIndex,
      characterName: identity.name,
      code: 'ARENA_RECONCILIATION_ROSTER_COMBATANT_MISSING',
      message: '本次 generation roster 中的角色未出现在当前卡片列表，已跳过。',
    }));
    const warnings: Array<Record<string, unknown>> = [...unmatchedCurrent, ...unmatchedRoster];
    if (reconciliation.matches.length === 0) {
      return respond({
        code: 'ARENA_RECONCILIATION_ROSTER_MISMATCH',
        error: 'No current combatant can be matched to the generation roster',
        errors: warnings,
      }, 409);
    }

    const impacts = Array.isArray(authoritative.impacts)
      ? authoritative.impacts.flatMap((value) => recordOf(value) ? [recordOf(value)!] : [])
      : [];
    const impactByRosterIndex = new Map<number, Record<string, unknown>>();
    for (const impact of impacts) {
      const index = integerOf(impact.combatantIndex);
      if (index !== null && !impactByRosterIndex.has(index)) impactByRosterIndex.set(index, impact);
    }
    const uniqueRosterNameIndexes = new Map<string, number>();
    const duplicateRosterNames = new Set<string>();
    for (const frozen of roster.flatMap((value, index) => {
      const identity = rosterIdentity(value, index);
      return identity ? [identity] : [];
    })) {
      const token = nameToken(frozen.name);
      if (!token) continue;
      if (uniqueRosterNameIndexes.has(token)) duplicateRosterNames.add(token);
      else uniqueRosterNameIndexes.set(token, frozen.sortIndex);
    }
    const warnedAmbiguousImpactNames = new Set<string>();
    for (const impact of impacts) {
      if (integerOf(impact.combatantIndex) !== null) continue;
      const token = nameToken(stringOf(impact.characterName));
      if (duplicateRosterNames.has(token)) {
        if (token && !warnedAmbiguousImpactNames.has(token)) {
          warnedAmbiguousImpactNames.add(token);
          warnings.push({
            characterName: stringOf(impact.characterName),
            code: 'ARENA_RECONCILIATION_IMPACT_AMBIGUOUS',
            message: '旧战报中的同名角色影响无法唯一归属，已跳过该影响。',
          });
        }
        continue;
      }
      const index = uniqueRosterNameIndexes.get(token);
      if (index !== undefined && !impactByRosterIndex.has(index)) {
        impactByRosterIndex.set(index, impact);
      }
    }

    const frozenRoster = roster.flatMap((value, index) => {
      const identity = rosterIdentity(value, index);
      return identity ? [identity] : [];
    });
    const nativeStatesByName = new Map<string, Set<boolean>>();
    for (const frozen of frozenRoster) {
      const token = nameToken(frozen.name);
      if (!token) continue;
      const states = nativeStatesByName.get(token) ?? new Set<boolean>();
      states.add(frozen.native);
      nativeStatesByName.set(token, states);
    }
    const conflictingNativeNames = new Set(
      [...nativeStatesByName.entries()]
        .filter(([, states]) => states.has(true) && states.has(false))
        .map(([token]) => token),
    );

    const verifiedCombatants = await Promise.all(reconciliation.matches.map(async (match) => {
      let currentNative = false;
      try {
        currentNative = await resolveArenaCombatantNativeAuthority(
          match.current.value,
          verifySignature,
        );
      } catch {
        log.warn('角色原生 authority 检查失败，将按非原生继续', {
          generationId,
          combatantIndex: match.current.position,
        });
      }
      if (match.current.value.isNative === true && !currentNative) {
        log.warn('角色声称原生但服务器 authority 无效，将视为非原生', {
          generationId,
          combatantIndex: match.current.position,
        });
      }
      const currentData = recordOf(match.current.value.data)!;
      const currentSignature = stringOf(currentData.signature);
      const canonicalPreset = currentNative
        && match.roster.isPreset
        && await isCanonicalArenaCharacterPreset(match.current.value).catch(() => false);
      const hasCausalNativeIdentity = Boolean(
        currentNative
        && match.roster.native
        && (
          (currentSignature && currentSignature === match.roster.nativeSignature)
          || (canonicalPreset && setsIntersect(
            match.current.presetTemplates,
            match.roster.presetTemplates,
          ))
        )
        && !conflictingNativeNames.has(nameToken(match.roster.name)),
      );
      return {
        type: match.current.type,
        data: currentData,
        isNative: hasCausalNativeIdentity,
        characterGuidance: match.roster.characterGuidance,
      };
    }));
    const mappedImpacts = reconciliation.matches.map((match) => ({
      ...(impactByRosterIndex.get(match.roster.sortIndex) ?? {}),
      combatantIndex: match.current.position,
      characterName: match.current.name ?? match.roster.name ?? `角色#${match.current.position + 1}`,
    }));
    const report = recordOf(authoritative.report);
    if (!report) throw new Error('ARENA_RECONCILIATION_REPORT_INVALID');
    const scenarioAuthority = recordOf(authoritative.scenario);
    const updatedCombatants = await applyPostBattleUpdates(
      verifiedCombatants,
      report as never,
      mappedImpacts as never,
      stringOf(authoritative.userGuidance),
      scenarioAuthority ? { title: stringOf(scenarioAuthority.title) } : null,
      {
        generationId,
        combatantIndices: reconciliation.matches.map((match) => match.current.position),
        scenarioNativeOverride: scenarioAuthority?.isNative === true,
        participantNames: frozenRoster.map((identity) => identity.name ?? '未知角色'),
        nonNativeDataInvolved: frozenRoster.some((identity) => !identity.native)
          || (stringOf(report.mode) === 'scenario' && scenarioAuthority?.isNative !== true),
        conflictingNativeNames: [...conflictingNativeNames],
        writeArenaHistory: authoritative.writeArenaHistory === true,
        writeCurrentState: authoritative.writeCurrentState === true,
      },
    );

    return respond({ updatedCombatants, warnings, success: true });
  } catch (error) {
    log.error('更新角色数据时发生错误', { error, generationId });
    return respond({
      code: 'ARENA_RECONCILIATION_FAILED',
      error: '更新角色数据失败',
    }, 500);
  }
}

export const appRouteHandler = handler;
export default appRouteHandler;
