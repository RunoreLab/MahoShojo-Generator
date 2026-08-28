import { randomUUID } from 'node:crypto';

import {
  ArenaRoomSharedConfigSchema,
  DisplayNameSchema,
  RoomDirectoryTitleSchema,
  RoomDirectoryVisibilitySchema,
  type ArenaRoomSharedConfig,
  type RoomDirectoryVisibility,
  type RoomMember,
} from '@mahoshojo/contracts/arena-room';
import type { ArenaRoomAuthorityState } from '@mahoshojo/multiplayer-core';

import {
  RoomActor,
  RoomActorRegistry,
} from './room-actor-registry';
import type { ArenaRoomDirectoryService } from './room-directory-service';

export type ArenaRoomMembershipErrorCode =
  | 'ROOM_CLOSED'
  | 'ROOM_INPUT_INVALID'
  | 'ROOM_MEMBERSHIP_NOT_ACTIVE'
  | 'ROOM_MEMBERSHIP_REVOKED'
  | 'ROOM_MEMBERSHIP_TRANSITION_DENIED'
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

export type ArenaRoomMembershipService = {
  create(input: {
    readonly accountUserId: number;
    readonly displayName: string;
    readonly sharedConfig: ArenaRoomSharedConfig;
    readonly directory?: {
      readonly title: string;
      readonly visibility: RoomDirectoryVisibility;
    };
  }): Promise<ArenaRoomMembershipView>;
  join(input: {
    readonly roomId: string;
    readonly accountUserId: number;
    readonly displayName: string;
  }): Promise<ArenaRoomMembershipView>;
  leave(input: {
    readonly roomId: string;
    readonly accountUserId: number;
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
};

export type ArenaRoomMembershipServiceOptions = {
  readonly actors: RoomActorRegistry;
  readonly createUserId?: () => string;
  readonly directory?: Pick<ArenaRoomDirectoryService, 'registerOpen'>;
  readonly now?: () => string;
  readonly onDirectoryError?: (error: unknown) => void;
};

const fail = (code: ArenaRoomMembershipErrorCode): never => {
  throw new ArenaRoomMembershipError(code);
};

const validAccountUserId = (value: number): boolean => (
  Number.isSafeInteger(value) && value > 0
);

const view = (
  roomId: string,
  roomEpoch: string,
  member: RoomMember,
): ArenaRoomMembershipView => ({
  roomId,
  roomEpoch,
  member: structuredClone(member),
});

export const createArenaRoomMembershipService = (
  options: ArenaRoomMembershipServiceOptions,
): ArenaRoomMembershipService => {
  const createUserId = options.createUserId ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());

  const reportDirectoryError = (error: unknown): void => {
    try {
      options.onDirectoryError?.(error);
    } catch {
      // Derived-directory diagnostics cannot alter an acknowledged Room checkpoint.
    }
  };

  const recoverOpenActor = async (roomId: string): Promise<{
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
    async create(input) {
      const displayName = DisplayNameSchema.safeParse(input.displayName);
      const sharedConfig = ArenaRoomSharedConfigSchema.safeParse(input.sharedConfig);
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
        || (input.directory !== undefined && options.directory === undefined)
        || (directoryTitle !== null && !directoryTitle.success)
        || (directoryVisibility !== null && !directoryVisibility.success)
      ) {
        return fail('ROOM_INPUT_INVALID');
      }
      const userId = createUserId();
      const result = await options.actors.create({
        authority: {
          kind: 'authenticated-user',
          actorUserId: userId,
          accountUserId: input.accountUserId,
        },
        host: { userId, displayName: displayName.data },
        sharedConfig: sharedConfig.data,
        ...(directoryTitle?.success && directoryVisibility?.success
          ? {
              directory: {
                title: directoryTitle.data,
                visibility: directoryVisibility.data,
              },
            }
          : {}),
      });
      if (!result.result.ok) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      const member = result.result.nextState.snapshot.members.find((entry) => entry.userId === userId);
      if (!member) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      if (
        options.directory !== undefined
        && directoryTitle?.success
        && directoryVisibility?.success
      ) {
        try {
          await options.directory.registerOpen({
            roomId: result.roomId,
            roomEpoch: result.roomEpoch,
            hostUserId: input.accountUserId,
            title: directoryTitle.data,
            visibility: directoryVisibility.data,
            status: 'open',
            createdAt: result.result.nextState.lifecycle.createdAt,
            lastActivityAt: result.result.nextState.lifecycle.updatedAt,
          });
        } catch (error) {
          reportDirectoryError(error);
        }
      }
      return view(result.roomId, result.roomEpoch, member);
    },

    async join(input) {
      const displayName = DisplayNameSchema.safeParse(input.displayName);
      if (!validAccountUserId(input.accountUserId) || !displayName.success) {
        return fail('ROOM_INPUT_INVALID');
      }
      const initial = await recoverOpenActor(input.roomId);
      const existing = activeRecordByAccount(initial.state, input.accountUserId);
      if (existing?.member.membershipState === 'revoked') return fail('ROOM_MEMBERSHIP_REVOKED');
      if (existing) return view(input.roomId, initial.state.snapshot.roomEpoch, existing.member);

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
          return view(input.roomId, current.snapshot.roomEpoch, concurrent.member);
        }
        if (concurrent?.member.membershipState === 'revoked') return fail('ROOM_MEMBERSHIP_REVOKED');
        return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      }
      const member = result.nextState.snapshot.members.find((entry) => entry.userId === userId);
      if (!member) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      return view(input.roomId, result.nextState.snapshot.roomEpoch, member);
    },

    async leave(input) {
      if (!validAccountUserId(input.accountUserId)) return fail('ROOM_INPUT_INVALID');
      const { actor, state } = await recoverOpenActor(input.roomId);
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
          expectedRoomEpoch: state.snapshot.roomEpoch,
          timestamp: now(),
        },
      });
      if (!result.ok) return fail('ROOM_MEMBERSHIP_TRANSITION_DENIED');
      const current = result.nextState.memberAuthority.find((entry) => (
        entry.accountUserId === input.accountUserId
      ))?.member ?? record.member;
      return view(input.roomId, result.nextState.snapshot.roomEpoch, current);
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
  });
};
