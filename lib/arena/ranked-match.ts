import { generateSignature, verifySignature } from '@/lib/signature';
import { buildEntityKey, buildPairKey, type ArenaEntity } from '@/lib/database/arena-ratings';
import { generateUUID } from '@/lib/database/core';

export type RankedMatchQueue = 'strict';
export type RankedMatchEntityType = 'data_card' | 'preset';

export interface RankedMatchEntity {
  entityType: RankedMatchEntityType;
  entityId: string;
}

export interface RankedMatchTicketV1 {
  kind: 'arena-ranked-match';
  version: 1;
  queue: RankedMatchQueue;
  matchId: string;
  userId: number;
  issuedAt: string;
  expiresAt: string;
  player: RankedMatchEntity;
  opponent: RankedMatchEntity;
  config: {
    mode: 'classic';
    selectedLevel: string | null;
    language: string | null;
    storyLength: string | null;
  };
  signature: string;
}

export type RankedMatchTicket = RankedMatchTicketV1;

export type RankedMatchIssueResult =
  | { ok: true; ticket: RankedMatchTicketV1 }
  | { ok: false; error: string };

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const isFinitePositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;

const isRankedMatchEntity = (value: unknown): value is RankedMatchEntity => {
  if (!value || typeof value !== 'object') return false;
  const anyValue = value as RankedMatchEntity;
  if (anyValue.entityType !== 'data_card' && anyValue.entityType !== 'preset') return false;
  if (typeof anyValue.entityId !== 'string') return false;
  return Boolean(anyValue.entityId.trim());
};

const parseRankedMatchTicketV1 = (value: unknown): RankedMatchTicketV1 | null => {
  if (!value || typeof value !== 'object') return null;
  const anyValue = value as RankedMatchTicketV1;
  if (anyValue.kind !== 'arena-ranked-match') return null;
  if (anyValue.version !== 1) return null;
  if (anyValue.queue !== 'strict') return null;
  if (typeof anyValue.matchId !== 'string' || !anyValue.matchId.trim()) return null;
  if (!isFinitePositiveInt(anyValue.userId)) return null;
  if (typeof anyValue.issuedAt !== 'string' || !anyValue.issuedAt.trim()) return null;
  if (typeof anyValue.expiresAt !== 'string' || !anyValue.expiresAt.trim()) return null;
  if (!isRankedMatchEntity(anyValue.player)) return null;
  if (!isRankedMatchEntity(anyValue.opponent)) return null;
  if (!anyValue.config || typeof anyValue.config !== 'object') return null;
  if (anyValue.config.mode !== 'classic') return null;
  if ('selectedLevel' in anyValue.config && anyValue.config.selectedLevel !== null && typeof anyValue.config.selectedLevel !== 'string') {
    return null;
  }
  if ('language' in anyValue.config && anyValue.config.language !== null && typeof anyValue.config.language !== 'string') {
    return null;
  }
  if ('storyLength' in anyValue.config && anyValue.config.storyLength !== null && typeof anyValue.config.storyLength !== 'string') {
    return null;
  }
  if (typeof anyValue.signature !== 'string' || !anyValue.signature.trim()) return null;
  return anyValue;
};

const toArenaEntity = (entity: RankedMatchEntity): ArenaEntity => ({
  entityType: entity.entityType,
  entityId: entity.entityId,
});

export async function issueRankedMatchTicket(input: {
  userId: number;
  player: RankedMatchEntity;
  opponent: RankedMatchEntity;
  mode: 'classic';
  selectedLevel: string | null;
  language: string | null;
  storyLength: string | null;
  expiresInMs: number;
}): Promise<RankedMatchIssueResult> {
  if (!isFinitePositiveInt(input.userId)) return { ok: false, error: '用户身份无效，无法进行排位匹配' };
  if (!isRankedMatchEntity(input.player)) return { ok: false, error: '参战角色无效，无法进行排位匹配' };
  if (!isRankedMatchEntity(input.opponent)) return { ok: false, error: '对手无效，无法进行排位匹配' };

  const issuedAtMs = Date.now();
  const issuedAt = new Date(issuedAtMs).toISOString();
  const expiresAtMs = issuedAtMs + Math.max(1, Math.floor(input.expiresInMs));
  const expiresAt = new Date(expiresAtMs).toISOString();

  const payload: Omit<RankedMatchTicketV1, 'signature'> = {
    kind: 'arena-ranked-match',
    version: 1,
    queue: 'strict',
    matchId: generateUUID(),
    userId: input.userId,
    issuedAt,
    expiresAt,
    player: { entityType: input.player.entityType, entityId: input.player.entityId.trim() },
    opponent: { entityType: input.opponent.entityType, entityId: input.opponent.entityId.trim() },
    config: {
      mode: input.mode,
      selectedLevel: normalizeOptionalString(input.selectedLevel),
      language: normalizeOptionalString(input.language),
      storyLength: normalizeOptionalString(input.storyLength),
    },
  };

  const signature = await generateSignature(payload);
  if (!signature) {
    return { ok: false, error: '服务端未配置签名密钥（SIGNATURE_SECRET_KEY），暂无法启用排位匹配' };
  }

  return { ok: true, ticket: { ...payload, signature } };
}

export type RankedMatchValidationResult = {
  ok: boolean;
  queue: RankedMatchQueue | null;
  matchId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  playerKey: string | null;
  opponentKey: string | null;
  reason:
    | 'missing'
    | 'invalid-shape'
    | 'invalid-signature'
    | 'need-login'
    | 'user-mismatch'
    | 'expired'
    | 'settings-changed'
    | 'combatants-not-2'
    | 'combatants-unrankable'
    | 'roster-changed'
    | null;
};

const buildEntityFromClientCombatant = (combatant: unknown): RankedMatchEntity | null => {
  if (!combatant || typeof combatant !== 'object') return null;
  const anyCombatant = combatant as any;

  const isPreset = Boolean(anyCombatant.isPreset);
  if (isPreset) {
    const filename = typeof anyCombatant.filename === 'string' ? anyCombatant.filename.trim() : '';
    if (!filename) return null;
    return { entityType: 'preset', entityId: filename };
  }

  const dataCardId = typeof anyCombatant.sourceDataCardId === 'string' ? anyCombatant.sourceDataCardId.trim() : '';
  if (!dataCardId) return null;
  return { entityType: 'data_card', entityId: dataCardId };
};

export async function validateRankedMatchTicketForRequest(input: {
  ticket: unknown;
  userId: number | null;
  combatants: unknown;
  mode: unknown;
  selectedLevel: unknown;
  language: unknown;
  storyLength: unknown;
  nowMs?: number;
}): Promise<RankedMatchValidationResult> {
  if (input.ticket == null) {
    return {
      ok: false,
      queue: null,
      matchId: null,
      issuedAt: null,
      expiresAt: null,
      playerKey: null,
      opponentKey: null,
      reason: 'missing',
    };
  }

  const ticket = parseRankedMatchTicketV1(input.ticket);
  if (!ticket) {
    return {
      ok: false,
      queue: null,
      matchId: null,
      issuedAt: null,
      expiresAt: null,
      playerKey: null,
      opponentKey: null,
      reason: 'invalid-shape',
    };
  }

  const signatureOk = await verifySignature(ticket);
  if (!signatureOk) {
    return {
      ok: false,
      queue: ticket.queue,
      matchId: ticket.matchId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
      playerKey: buildEntityKey(toArenaEntity(ticket.player)),
      opponentKey: buildEntityKey(toArenaEntity(ticket.opponent)),
      reason: 'invalid-signature',
    };
  }

  if (!isFinitePositiveInt(input.userId)) {
    return {
      ok: false,
      queue: ticket.queue,
      matchId: ticket.matchId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
      playerKey: buildEntityKey(toArenaEntity(ticket.player)),
      opponentKey: buildEntityKey(toArenaEntity(ticket.opponent)),
      reason: 'need-login',
    };
  }

  if (ticket.userId !== input.userId) {
    return {
      ok: false,
      queue: ticket.queue,
      matchId: ticket.matchId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
      playerKey: buildEntityKey(toArenaEntity(ticket.player)),
      opponentKey: buildEntityKey(toArenaEntity(ticket.opponent)),
      reason: 'user-mismatch',
    };
  }

  const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
  const expiresAtMs = Date.parse(ticket.expiresAt);
  if (!Number.isFinite(expiresAtMs) || nowMs > expiresAtMs) {
    return {
      ok: false,
      queue: ticket.queue,
      matchId: ticket.matchId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
      playerKey: buildEntityKey(toArenaEntity(ticket.player)),
      opponentKey: buildEntityKey(toArenaEntity(ticket.opponent)),
      reason: 'expired',
    };
  }

  const normalizedMode = typeof input.mode === 'string' ? input.mode.trim() : '';
  if (normalizedMode !== ticket.config.mode) {
    return {
      ok: false,
      queue: ticket.queue,
      matchId: ticket.matchId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
      playerKey: buildEntityKey(toArenaEntity(ticket.player)),
      opponentKey: buildEntityKey(toArenaEntity(ticket.opponent)),
      reason: 'settings-changed',
    };
  }

  const normalizedSelectedLevel = normalizeOptionalString(input.selectedLevel);
  const normalizedLanguage = normalizeOptionalString(input.language);
  const normalizedStoryLength = normalizeOptionalString(input.storyLength);

  const expectedSelectedLevel = normalizeOptionalString(ticket.config.selectedLevel);
  const expectedLanguage = normalizeOptionalString(ticket.config.language);
  const expectedStoryLength = normalizeOptionalString(ticket.config.storyLength);

  if (
    normalizedSelectedLevel !== expectedSelectedLevel ||
    normalizedLanguage !== expectedLanguage ||
    normalizedStoryLength !== expectedStoryLength
  ) {
    return {
      ok: false,
      queue: ticket.queue,
      matchId: ticket.matchId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
      playerKey: buildEntityKey(toArenaEntity(ticket.player)),
      opponentKey: buildEntityKey(toArenaEntity(ticket.opponent)),
      reason: 'settings-changed',
    };
  }

  if (!Array.isArray(input.combatants) || input.combatants.length !== 2) {
    return {
      ok: false,
      queue: ticket.queue,
      matchId: ticket.matchId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
      playerKey: buildEntityKey(toArenaEntity(ticket.player)),
      opponentKey: buildEntityKey(toArenaEntity(ticket.opponent)),
      reason: 'combatants-not-2',
    };
  }

  const requestEntities = (input.combatants as unknown[]).map(buildEntityFromClientCombatant);
  if (requestEntities.some((e) => e == null)) {
    return {
      ok: false,
      queue: ticket.queue,
      matchId: ticket.matchId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
      playerKey: buildEntityKey(toArenaEntity(ticket.player)),
      opponentKey: buildEntityKey(toArenaEntity(ticket.opponent)),
      reason: 'combatants-unrankable',
    };
  }

  const [a, b] = requestEntities as [RankedMatchEntity, RankedMatchEntity];
  const requestPairKey = buildPairKey(toArenaEntity(a), toArenaEntity(b));
  const ticketPairKey = buildPairKey(toArenaEntity(ticket.player), toArenaEntity(ticket.opponent));
  if (requestPairKey !== ticketPairKey) {
    return {
      ok: false,
      queue: ticket.queue,
      matchId: ticket.matchId,
      issuedAt: ticket.issuedAt,
      expiresAt: ticket.expiresAt,
      playerKey: buildEntityKey(toArenaEntity(ticket.player)),
      opponentKey: buildEntityKey(toArenaEntity(ticket.opponent)),
      reason: 'roster-changed',
    };
  }

  const playerKey = buildEntityKey(toArenaEntity(ticket.player));
  const opponentKey = buildEntityKey(toArenaEntity(ticket.opponent));

  return {
    ok: true,
    queue: ticket.queue,
    matchId: ticket.matchId,
    issuedAt: ticket.issuedAt,
    expiresAt: ticket.expiresAt,
    playerKey,
    opponentKey,
    reason: null,
  };
}

export const buildRankedMatchExtraJson = (result: RankedMatchValidationResult): Record<string, unknown> | null => {
  if (!result.matchId || !result.queue) return null;
  return {
    rankedMatchQueue: result.queue,
    rankedMatchId: result.matchId,
    rankedMatchIssuedAt: result.issuedAt,
    rankedMatchExpiresAt: result.expiresAt,
    rankedMatchPlayerKey: result.playerKey,
    rankedMatchOpponentKey: result.opponentKey,
    rankedMatchOk: result.ok,
    rankedMatchReason: result.ok ? null : result.reason,
  };
};

