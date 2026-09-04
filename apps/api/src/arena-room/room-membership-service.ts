import { createHash, randomUUID } from 'node:crypto';

import {
  ArenaRoomSharedConfigSchema,
  ArenaRoomCreationRequestIdSchema,
  DisplayNameSchema,
  OpaqueKeySchema,
  RoomDirectoryTitleSchema,
  RoomDirectoryVisibilitySchema,
  type ArenaRoomSharedConfig,
  type ArenaRoomSnapshot,
  type RoomDirectoryVisibility,
  type RoomMember,
} from '@mahoshojo/contracts/arena-room';
import {
  projectArenaRoomSnapshotForViewer,
  type ArenaRoomAuthorityState,
  type ArenaRoomMemberAuthorityRecord,
} from '@mahoshojo/multiplayer-core';

import {
  ArenaDataCardRefVerifierError,
  type ArenaDataCardRefVerifier,
} from './arena-data-card-ref-verifier';
import {
  ArenaRoomPresetRefVerifierError,
  verifyArenaRoomSharedConfigPresetRefs,
  verifyArenaRoomSharedConfigRefs,
} from './arena-room-shared-config-refs';
import type { ArenaRoomGenerationPresetResolver } from './room-generation-preset-registry';
import {
  RoomActor,
  RoomActorRegistry,
} from './room-actor-registry';
import type {
  RedisRoomCreationReceipt,
  RedisRoomStore,
} from './redis-room-store';

export type ArenaRoomMembershipErrorCode =
  | 'ROOM_CLOSED'
  | 'ROOM_CONFIG_FRAME_TOO_LARGE'
  | 'ROOM_EPOCH_STALE'
  | 'ROOM_INPUT_INVALID'
  | 'ROOM_CREATION_REQUEST_CONFLICT'
  | 'ROOM_MEMBERSHIP_NOT_ACTIVE'
  | 'ROOM_MEMBERSHIP_REVOKED'
  | 'ROOM_MEMBERSHIP_KICKED'
  | 'ROOM_MEMBERSHIP_TRANSITION_DENIED'
  | 'ROOM_MEMBER_LIMIT_REACHED'
  | 'ROOM_PERMISSION_DENIED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_REFERENCE_DENIED'
  | 'ROOM_REFERENCE_STALE'
  | 'ROOM_REFERENCE_UNAVAILABLE';

export class ArenaRoomMembershipError extends Error {
  constructor(readonly code: ArenaRoomMembershipErrorCode) {
    super(code);
    this.name = 'ArenaRoomMembershipError';
  }
}

export type ArenaRoomMembershipView = {
  readonly roomId: string;
  readonly roomEpoch: string;
  readonly member: RoomMember;
};

export type ResolvedArenaRoomMembership = ArenaRoomMembershipView & {
  readonly accountUserId: number;
  readonly actor: RoomActor;
  readonly state: ArenaRoomAuthorityState;
};

export type ArenaRoomSessionView = ArenaRoomMembershipView & {
  readonly snapshot: ArenaRoomSnapshot;
};

export type ArenaRoomMembershipService = {
  hasCreationReceipt(input: {
    readonly accountUserId: number;
    readonly creationRequestId: string;
  }): Promise<boolean>;
  create(input: {
    readonly accountUserId: number;
    readonly creationRequestId?: string;
    readonly requireExistingCreationReceipt?: boolean;
    readonly displayName: string;
    readonly sharedConfig: ArenaRoomSharedConfig;
    readonly directory?: {
      readonly title: string;
      readonly visibility: RoomDirectoryVisibility;
    };
  }): Promise<ArenaRoomSessionView>;
  join(input: {
    readonly roomId: string;
    readonly accountUserId: number;
    readonly displayName: string;
  }): Promise<ArenaRoomSessionView>;
  leave(input: {
    readonly roomId: string;
    readonly accountUserId: number;
    readonly expectedRoomEpoch: string;
  }): Promise<ArenaRoomMembershipView>;
  close(input: {
    readonly roomId: string;
    readonly accountUserId: number;
    readonly expectedRoomEpoch: string;
  }): Promise<ArenaRoomMembershipView>;
  kick(input: {
    readonly roomId: string;
    readonly accountUserId: number;
    readonly targetUserId: string;
    readonly expectedRoomEpoch: string;
  }): Promise<ArenaRoomSessionView>;
  resolveActiveByAccount(input: {
    readonly roomId: string;
    readonly accountUserId: number;
  }): Promise<ResolvedArenaRoomMembership>;
  resolveActiveByUser(input: {
    readonly roomId: string;
    readonly userId: string;
  }): Promise<ResolvedArenaRoomMembership>;
  getSession(input: {
    readonly roomId: string;
    readonly accountUserId: number;
  }): Promise<ArenaRoomSessionView>;
};

export type ArenaRoomMembershipServiceOptions = {
  readonly actors: RoomActorRegistry;
  readonly creationReceipts?: Pick<RedisRoomStore, 'loadCreationReceipt'>;
  readonly references?: ArenaDataCardRefVerifier;
  readonly presets?: Pick<ArenaRoomGenerationPresetResolver, 'resolve'>;
  readonly createUserId?: () => string;
  readonly now?: () => string;
};

const fail = (code: ArenaRoomMembershipErrorCode): never => {
  throw new ArenaRoomMembershipError(code);
};

const validAccountUserId = (value: number): boolean => (
  Number.isSafeInteger(value) && value > 0
);

const mapReferenceError = (error: unknown): never => {
  if (!(error instanceof ArenaDataCardRefVerifierError)) throw error;
  switch (error.code) {
    case 'ARENA_DATA_CARD_REF_VERSION_MISMATCH': return fail('ROOM_REFERENCE_STALE');
    case 'ARENA_DATA_CARD_REF_NOT_READABLE': return fail('ROOM_REFERENCE_DENIED');
    default: return fail('ROOM_REFERENCE_UNAVAILABLE');
  }
};

const mapPresetReferenceError = (error: unknown): never => {
  if (!(error instanceof ArenaRoomPresetRefVerifierError)) throw error;
  switch (error.code) {
    case 'ARENA_ROOM_PRESET_REF_INPUT_INVALID': return fail('ROOM_INPUT_INVALID');
    case 'ARENA_ROOM_PRESET_REF_NOT_FOUND':
    case 'ARENA_ROOM_PRESET_REF_VERSION_MISMATCH': return fail('ROOM_REFERENCE_STALE');
    default: return fail('ROOM_REFERENCE_UNAVAILABLE');
  }
};

const canonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  );
};

const creationRequestDigest = (input: {
  readonly displayName: string;
  readonly directory?: { readonly title: string; readonly visibility: RoomDirectoryVisibility };
  readonly sharedConfig: ArenaRoomSharedConfig;
}): string => `sha256:${createHash('sha256')
  .update(JSON.stringify(canonicalJsonValue(input)))
  .digest('hex')}`;

const view = (
  roomId: string,
  roomEpoch: string,
  member: RoomMember,
): ArenaRoomMembershipView => ({
  roomId,
  roomEpoch,
  member: structuredClone(member),
});

const sessionView = (
  roomId: string,
  state: ArenaRoomAuthorityState,
  member: RoomMember,
): ArenaRoomSessionView => ({
  ...view(roomId, state.snapshot.roomEpoch, member),
  snapshot: projectArenaRoomSnapshotForViewer(state.snapshot, member.userId),
});

export const createArenaRoomMembershipService = (
  options: ArenaRoomMembershipServiceOptions,
): ArenaRoomMembershipService => {
  const createUserId = options.createUserId ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());

  const recoverActor = async (roomId: string): Promise<{
    actor: RoomActor;
    state: ArenaRoomAuthorityState;
  }> => {
    if (typeof roomId !== 'string' || !roomId || roomId.length > 256) {
      return fail('ROOM_INPUT_INVALID');
    }
    const actor = await options.actors.recover(roomId);
    if (!actor) return fail('ROOM_NOT_FOUND');
    const state = actor.getSnapshot();
    if (!state) return fail('ROOM_NOT_FOUND');
    return { actor, state };
  };

  const recoverOpenActor = async (roomId: string): Promise<{
    actor: RoomActor;
    state: ArenaRoomAuthorityState;
  }> => {
    const { actor, state } = await recoverActor(roomId);
    if (state.lifecycle.status === 'closed') return fail('ROOM_CLOSED');
    return { actor, state };
  };

  const activeRecordByAccount = (
    state: ArenaRoomAuthorityState,
    accountUserId: number,
  ) => state.memberAuthority.find((entry) => entry.accountUserId === accountUserId);

  const activeRecordByUser = (
    state: ArenaRoomAuthorityState,
    userId: string,
  ) => state.memberAuthority.find((entry) => entry.member.userId === userId);

  const sessionFromCreationReceipt = async (input: {
    readonly accountUserId: number;
    readonly creationRequestId: string;
    readonly requestDigest: string;
    readonly receipt?: RedisRoomCreationReceipt;
  }): Promise<ArenaRoomSessionView | null> => {
    if (!options.creationReceipts) throw new Error('ROOM_CREATION_RECEIPT_STORE_REQUIRED');
    const receipt = input.receipt ?? await options.creationReceipts.loadCreationReceipt(input);
    if (receipt === null) return null;
    if (receipt.requestDigest !== input.requestDigest) {
      return fail('ROOM_CREATION_REQUEST_CONFLICT');
    }
    let recovered: { actor: RoomActor; state: ArenaRoomAuthorityState } | null = null;
    for (let attempt = 0; attempt < 2 && recovered === null; attempt += 1) {
      try {
        recovered = await recoverOpenActor(receipt.roomId);
      } catch (error) {
        if (
          !(error instanceof ArenaRoomMembershipError)
          || (error.code !== 'ROOM_NOT_FOUND' && error.code !== 'ROOM_CLOSED')
        ) throw error;
        if (error.code === 'ROOM_NOT_FOUND' && attempt === 0) {
          // A concurrent winner may have committed its receipt/checkpoint but not yet
          // installed the in-memory actor state. Yield once, then reconcile again.
          await Promise.resolve();
          continue;
        }
        return fail('ROOM_CREATION_REQUEST_CONFLICT');
      }
    }
    if (recovered === null) return fail('ROOM_CREATION_REQUEST_CONFLICT');
    const record = activeRecordByAccount(recovered.state, input.accountUserId);
    if (!record || record.member.membershipState !== 'active') {
      return fail('ROOM_CREATION_REQUEST_CONFLICT');
    }
    return sessionView(receipt.roomId, recovered.state, record.member);
  };

  const resolveRecord = async (
    input: { roomId: string; accountUserId?: number; userId?: string },
  ): Promise<ResolvedArenaRoomMembership> => {
    const { actor, state } = await recoverOpenActor(input.roomId);
    const record = input.accountUserId === undefined
      ? activeRecordByUser(state, input.userId ?? '')
      : activeRecordByAccount(state, input.accountUserId);
    if (!record) return fail('ROOM_MEMBERSHIP_NOT_ACTIVE');
    if (record.member.membershipState !== 'active') return fail('ROOM_MEMBERSHIP_REVOKED');
    return {
      ...view(input.roomId, state.snapshot.roomEpoch, record.member),
      accountUserId: record.accountUserId,
      actor,
      state,
    };
  };

  /**
   * 自愿离开（revocationReason='left'）成员的重进：沿用原 authority record 的
   * member userId，不消耗新的 authority history 槽位；被踢/legacy tombstone
   * 不走此路径。并发重进已在状态机内幂等，这里仅在失败后对账一次。
   */
  const rejoinSession = async (
    target: { readonly actor: RoomActor; readonly state: ArenaRoomAuthorityState },
    record: ArenaRoomMemberAuthorityRecord,
    accountUserId: number,
    displayName: string,
  ): Promise<ArenaRoomSessionView> => {
    const result = await target.actor.execute({
      authority: {
        kind: 'authenticated-user',
        actorUserId: record.member.userId,
        accountUserId,
      },
      command: {
        type: 'rejoin-member',
        expectedRoomEpoch: target.state.snapshot.roomEpoch,
        displayName,
        timestamp: now(),
      },
    });
    if (result.ok) {
      const member = result.nextState.snapshot.members.find((entry) => entry.userId === record.member.userId);
      if (!member) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      return sessionView(target.state.snapshot.roomId, result.nextState, member);
    }
    const current = target.actor.getSnapshot();
    const concurrent = current && activeRecordByAccount(current, accountUserId);
    if (current && concurrent?.member.membershipState === 'active') {
      return sessionView(current.snapshot.roomId, current, concurrent.member);
    }
    if (result.reason === 'member-limit-reached') return fail('ROOM_MEMBER_LIMIT_REACHED');
    return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
  };

  const revokedJoinFailure = (record: ArenaRoomMemberAuthorityRecord): never => fail(
    record.revocationReason === 'kicked'
      ? 'ROOM_MEMBERSHIP_KICKED'
      : 'ROOM_MEMBERSHIP_REVOKED',
  );

  return Object.freeze({
    async hasCreationReceipt(input) {
      const creationRequestId = ArenaRoomCreationRequestIdSchema.safeParse(
        input.creationRequestId,
      );
      if (!validAccountUserId(input.accountUserId) || !creationRequestId.success) {
        return fail('ROOM_INPUT_INVALID');
      }
      if (!options.creationReceipts) throw new Error('ROOM_CREATION_RECEIPT_STORE_REQUIRED');
      return await options.creationReceipts.loadCreationReceipt({
        accountUserId: input.accountUserId,
        creationRequestId: creationRequestId.data,
      }) !== null;
    },

    async create(input) {
      const displayName = DisplayNameSchema.safeParse(input.displayName);
      const sharedConfig = ArenaRoomSharedConfigSchema.safeParse(input.sharedConfig);
      const creationRequestId = input.creationRequestId === undefined
        ? null
        : ArenaRoomCreationRequestIdSchema.safeParse(input.creationRequestId);
      const directoryTitle = input.directory === undefined
        ? null
        : RoomDirectoryTitleSchema.safeParse(input.directory.title);
      const directoryVisibility = input.directory === undefined
        ? null
        : RoomDirectoryVisibilitySchema.safeParse(input.directory.visibility);
      if (
        !validAccountUserId(input.accountUserId)
        || !displayName.success
        || !sharedConfig.success
        || (creationRequestId !== null && !creationRequestId.success)
        || (directoryTitle !== null && !directoryTitle.success)
        || (directoryVisibility !== null && !directoryVisibility.success)
      ) {
        return fail('ROOM_INPUT_INVALID');
      }
      const digestInput = {
        displayName: displayName.data,
        ...(directoryTitle?.success && directoryVisibility?.success
          ? {
              directory: {
                title: directoryTitle.data,
                visibility: directoryVisibility.data,
              },
            }
          : {}),
        sharedConfig: sharedConfig.data,
      };
      const requestDigest = creationRequestDigest(digestInput);
      const receiptIdentity = creationRequestId?.success
        ? {
            accountUserId: input.accountUserId,
            creationRequestId: creationRequestId.data,
            requestDigest,
          }
        : null;
      if (receiptIdentity !== null) {
        const existing = await sessionFromCreationReceipt(receiptIdentity);
        if (existing !== null) return existing;
        if (input.requireExistingCreationReceipt === true) {
          return fail('ROOM_CREATION_REQUEST_CONFLICT');
        }
      } else if (input.requireExistingCreationReceipt === true) {
        return fail('ROOM_INPUT_INVALID');
      }
      try {
        await verifyArenaRoomSharedConfigRefs({
          references: options.references,
          sharedConfig: sharedConfig.data,
          hostAccountUserId: input.accountUserId,
        });
      } catch (error) {
        mapReferenceError(error);
      }
      try {
        await verifyArenaRoomSharedConfigPresetRefs({
          presets: options.presets,
          sharedConfig: sharedConfig.data,
        });
      } catch (error) {
        mapPresetReferenceError(error);
      }
      const userId = createUserId();
      let result;
      try {
        result = await options.actors.create({
          authority: {
            kind: 'authenticated-user',
            actorUserId: userId,
            accountUserId: input.accountUserId,
          },
          host: { userId, displayName: displayName.data },
          sharedConfig: sharedConfig.data,
          ...(receiptIdentity === null ? {} : { creationReceipt: receiptIdentity }),
          ...(directoryTitle?.success && directoryVisibility?.success
            ? {
                directory: {
                  title: directoryTitle.data,
                  visibility: directoryVisibility.data,
                },
              }
            : {}),
        });
      } catch (error) {
        if (
          receiptIdentity !== null
          && error instanceof Error
          && error.message === 'REDIS_ROOM_CREATION_RECEIPT_CONFLICT'
        ) {
          const existing = await sessionFromCreationReceipt(receiptIdentity);
          if (existing !== null) return existing;
        }
        throw error;
      }
      if (!result.result.ok) {
        if (result.result.reason === 'room-snapshot-too-large') {
          return fail('ROOM_CONFIG_FRAME_TOO_LARGE');
        }
        return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      }
      const member = result.result.nextState.snapshot.members.find((entry) => entry.userId === userId);
      if (!member) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      return sessionView(result.roomId, result.result.nextState, member);
    },

    async join(input) {
      const displayName = DisplayNameSchema.safeParse(input.displayName);
      if (!validAccountUserId(input.accountUserId) || !displayName.success) {
        return fail('ROOM_INPUT_INVALID');
      }
      const initial = await recoverOpenActor(input.roomId);
      const existing = activeRecordByAccount(initial.state, input.accountUserId);
      if (existing?.member.membershipState === 'active') {
        return sessionView(input.roomId, initial.state, existing.member);
      }
      if (existing?.member.membershipState === 'revoked') {
        if (existing.revocationReason === 'left') {
          return rejoinSession(initial, existing, input.accountUserId, displayName.data);
        }
        return revokedJoinFailure(existing);
      }

      const userId = createUserId();
      const timestamp = now();
      const authority = {
        kind: 'authenticated-user' as const,
        actorUserId: userId,
        accountUserId: input.accountUserId,
      };
      const result = await initial.actor.execute({
        authority,
        command: {
          type: 'join-member',
          expectedRoomEpoch: initial.state.snapshot.roomEpoch,
          member: {
            userId,
            role: 'member',
            displayName: displayName.data,
            membershipState: 'active',
            joinedAt: timestamp,
          },
          timestamp,
        },
      });
      if (!result.ok) {
        const current = initial.actor.getSnapshot();
        const concurrent = current && activeRecordByAccount(current, input.accountUserId);
        if (current && concurrent?.member.membershipState === 'active') {
          return sessionView(input.roomId, current, concurrent.member);
        }
        if (current && concurrent?.member.membershipState === 'revoked') {
          if (concurrent.revocationReason === 'left') {
            return rejoinSession(
              { actor: initial.actor, state: current },
              concurrent,
              input.accountUserId,
              displayName.data,
            );
          }
          return revokedJoinFailure(concurrent);
        }
        if (result.reason === 'member-limit-reached') return fail('ROOM_MEMBER_LIMIT_REACHED');
        return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      }
      const member = result.nextState.snapshot.members.find((entry) => entry.userId === userId);
      if (!member) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      return sessionView(input.roomId, result.nextState, member);
    },

    async leave(input) {
      const expectedRoomEpoch = OpaqueKeySchema.safeParse(input.expectedRoomEpoch);
      if (!validAccountUserId(input.accountUserId) || !expectedRoomEpoch.success) {
        return fail('ROOM_INPUT_INVALID');
      }
      const { actor, state } = await recoverOpenActor(input.roomId);
      if (state.snapshot.roomEpoch !== expectedRoomEpoch.data) return fail('ROOM_EPOCH_STALE');
      const record = activeRecordByAccount(state, input.accountUserId);
      if (!record) return fail('ROOM_MEMBERSHIP_NOT_ACTIVE');
      if (record.member.membershipState === 'revoked') {
        return view(input.roomId, state.snapshot.roomEpoch, record.member);
      }
      const result = await actor.execute({
        authority: {
          kind: 'authenticated-user',
          actorUserId: record.member.userId,
          accountUserId: input.accountUserId,
        },
        command: {
          type: 'leave-member',
          expectedRoomEpoch: expectedRoomEpoch.data,
          timestamp: now(),
        },
      });
      if (!result.ok) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      const current = result.nextState.memberAuthority.find((entry) => (
        entry.accountUserId === input.accountUserId
      ))?.member ?? record.member;
      return view(input.roomId, result.nextState.snapshot.roomEpoch, current);
    },

    async close(input) {
      const expectedRoomEpoch = OpaqueKeySchema.safeParse(input.expectedRoomEpoch);
      if (!validAccountUserId(input.accountUserId) || !expectedRoomEpoch.success) {
        return fail('ROOM_INPUT_INVALID');
      }
      const { actor, state } = await recoverActor(input.roomId);
      if (state.snapshot.roomEpoch !== expectedRoomEpoch.data) return fail('ROOM_EPOCH_STALE');
      const record = activeRecordByAccount(state, input.accountUserId);
      if (!record || record.member.membershipState !== 'active') {
        return fail('ROOM_MEMBERSHIP_NOT_ACTIVE');
      }
      if (record.member.role !== 'host') return fail('ROOM_PERMISSION_DENIED');
      if (state.lifecycle.status === 'closed') {
        return view(input.roomId, state.snapshot.roomEpoch, record.member);
      }
      const result = await actor.execute({
        authority: {
          kind: 'authenticated-user',
          actorUserId: record.member.userId,
          accountUserId: input.accountUserId,
        },
        command: {
          type: 'leave-member',
          expectedRoomEpoch: expectedRoomEpoch.data,
          timestamp: now(),
        },
      });
      if (!result.ok) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      return view(input.roomId, result.nextState.snapshot.roomEpoch, record.member);
    },

    async kick(input) {
      const expectedRoomEpoch = OpaqueKeySchema.safeParse(input.expectedRoomEpoch);
      const targetUserId = OpaqueKeySchema.safeParse(input.targetUserId);
      if (
        !validAccountUserId(input.accountUserId)
        || !expectedRoomEpoch.success
        || !targetUserId.success
      ) return fail('ROOM_INPUT_INVALID');
      const { actor, state } = await recoverOpenActor(input.roomId);
      const caller = activeRecordByAccount(state, input.accountUserId);
      if (!caller || caller.member.membershipState !== 'active') {
        return fail('ROOM_MEMBERSHIP_NOT_ACTIVE');
      }
      if (caller.member.role !== 'host') return fail('ROOM_PERMISSION_DENIED');
      if (state.snapshot.roomEpoch !== expectedRoomEpoch.data) return fail('ROOM_EPOCH_STALE');
      if (caller.member.userId === targetUserId.data) return fail('ROOM_PERMISSION_DENIED');
      const target = activeRecordByUser(state, targetUserId.data);
      if (!target) return fail('ROOM_MEMBERSHIP_NOT_ACTIVE');
      if (target.member.role === 'host') return fail('ROOM_PERMISSION_DENIED');
      // 已被踢（或 legacy 无 reason）保持幂等成功；自愿离开（left）的目标必须
      // 继续提交 kick，把 tombstone 单调升级为 kicked，压缩 leave/kick 竞态。
      if (target.member.membershipState === 'revoked' && target.revocationReason !== 'left') {
        return sessionView(input.roomId, state, caller.member);
      }
      const result = await actor.execute({
        authority: {
          kind: 'authenticated-user',
          actorUserId: caller.member.userId,
          accountUserId: caller.accountUserId,
        },
        command: {
          type: 'kick-member',
          expectedRoomEpoch: expectedRoomEpoch.data,
          targetUserId: targetUserId.data,
          timestamp: now(),
        },
      });
      if (!result.ok) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      const currentCaller = activeRecordByAccount(result.nextState, input.accountUserId);
      if (!currentCaller || currentCaller.member.membershipState !== 'active') {
        return fail('ROOM_MEMBERSHIP_NOT_ACTIVE');
      }
      return sessionView(input.roomId, result.nextState, currentCaller.member);
    },

    async resolveActiveByAccount(input) {
      if (!validAccountUserId(input.accountUserId)) return fail('ROOM_INPUT_INVALID');
      return resolveRecord(input);
    },

    async resolveActiveByUser(input) {
      return resolveRecord(input);
    },

    async getSession(input) {
      if (!validAccountUserId(input.accountUserId)) return fail('ROOM_INPUT_INVALID');
      const membership = await resolveRecord(input);
      return sessionView(membership.roomId, membership.state, membership.member);
    },
  });
};
