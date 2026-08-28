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
} from '@mahoshojo/multiplayer-core';

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
  | 'ROOM_EPOCH_STALE'
  | 'ROOM_INPUT_INVALID'
  | 'ROOM_CREATION_REQUEST_CONFLICT'
  | 'ROOM_MEMBERSHIP_NOT_ACTIVE'
  | 'ROOM_MEMBERSHIP_REVOKED'
  | 'ROOM_MEMBERSHIP_TRANSITION_DENIED'
  | 'ROOM_PERMISSION_DENIED'
  | 'ROOM_NOT_FOUND';

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
  }): Promise<ArenaRoomMembershipView>;
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
  readonly createUserId?: () => string;
  readonly now?: () => string;
};

const fail = (code: ArenaRoomMembershipErrorCode): never => {
  throw new ArenaRoomMembershipError(code);
};

const validAccountUserId = (value: number): boolean => (
  Number.isSafeInteger(value) && value > 0
);

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
      if (!result.result.ok) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
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
      if (existing?.member.membershipState === 'revoked') return fail('ROOM_MEMBERSHIP_REVOKED');
      if (existing) return sessionView(input.roomId, initial.state, existing.member);

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
        if (concurrent?.member.membershipState === 'revoked') return fail('ROOM_MEMBERSHIP_REVOKED');
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
      if (!validAccountUserId(input.accountUserId)) return fail('ROOM_INPUT_INVALID');
      const { actor, state } = await recoverOpenActor(input.roomId);
      const caller = activeRecordByAccount(state, input.accountUserId);
      const target = activeRecordByUser(state, input.targetUserId);
      if (!caller || caller.member.membershipState !== 'active') {
        return fail('ROOM_MEMBERSHIP_NOT_ACTIVE');
      }
      if (!target) return fail('ROOM_MEMBERSHIP_NOT_ACTIVE');
      const result = await actor.execute({
        authority: {
          kind: 'authenticated-user',
          actorUserId: caller.member.userId,
          accountUserId: caller.accountUserId,
        },
        command: {
          type: 'kick-member',
          expectedRoomEpoch: state.snapshot.roomEpoch,
          targetUserId: input.targetUserId,
          timestamp: now(),
        },
      });
      if (!result.ok) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      const current = result.nextState.memberAuthority.find((entry) => (
        entry.member.userId === input.targetUserId
      ))?.member ?? target.member;
      return view(input.roomId, result.nextState.snapshot.roomEpoch, current);
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
