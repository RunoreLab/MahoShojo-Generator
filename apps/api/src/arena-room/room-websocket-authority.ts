import type {
  RoomClientTransportMessage,
  RoomReconnectCursor,
  RoomServerTransportMessage,
  RoomTicketClaims,
} from '@mahoshojo/contracts/arena-room';
import {
  issueArenaRoomPresenceAuthority,
  projectArenaRoomEventForViewer,
} from '@mahoshojo/multiplayer-core';

import {
  ArenaRoomMembershipError,
  type ArenaRoomMembershipService,
  type ResolvedArenaRoomMembership,
} from './room-membership-service';
import type { RoomActorRegistry } from './room-actor-registry';
import type { RedisRoomTicketReplayStore } from './redis-room-ticket-replay-store';
import type { ArenaRoomTicketCodec } from './room-ticket';
import type {
  RoomWebSocketAuthorization,
  RoomWebSocketConnection,
  RoomWebSocketConnectionAuthority,
  RoomWebSocketPeer,
} from './room-websocket-gateway';

const DEFAULT_HOST_OFFLINE_GRACE_MS = 45 * 60 * 1_000;
const DEFAULT_ROOM_IDLE_TTL_MS = 12 * 60 * 60 * 1_000;
const CLOSE_MEMBERSHIP_REVOKED = 1008;
const CLOSE_ROOM_TERMINAL = 1000;
const CLOSE_ROOM_AUTHORITY_UNAVAILABLE = 1013;

export type ArenaRoomWebSocketAuthority = {
  issue(input: {
    readonly roomId: string;
    readonly accountUserId: number;
    readonly reconnect?: RoomReconnectCursor;
  }): Promise<string>;
  authorize(request: Request): Promise<RoomWebSocketAuthorization>;
};

export type ArenaRoomWebSocketAuthorityOptions = {
  readonly actors: RoomActorRegistry;
  readonly memberships: ArenaRoomMembershipService;
  readonly replay: RedisRoomTicketReplayStore;
  readonly tickets: ArenaRoomTicketCodec;
  readonly now?: () => number;
  readonly hostOfflineGraceMs?: number;
  readonly roomIdleTtlMs?: number;
};

type PresenceCounts = {
  readonly users: Map<string, number>;
  total: number;
};

const rejected = (
  status: 401 | 403 | 503,
  code: string,
): RoomWebSocketAuthorization => ({ accepted: false, code, status });

const sameDeadlines = (
  left: { hostOfflineDeadline: string | null; roomIdleDeadline: string | null },
  right: { hostOfflineDeadline: string | null; roomIdleDeadline: string | null },
): boolean => left.hostOfflineDeadline === right.hostOfflineDeadline
  && left.roomIdleDeadline === right.roomIdleDeadline;

export const createArenaRoomWebSocketAuthority = (
  options: ArenaRoomWebSocketAuthorityOptions,
): ArenaRoomWebSocketAuthority => {
  const now = options.now ?? Date.now;
  const hostOfflineGraceMs = options.hostOfflineGraceMs ?? DEFAULT_HOST_OFFLINE_GRACE_MS;
  const roomIdleTtlMs = options.roomIdleTtlMs ?? DEFAULT_ROOM_IDLE_TTL_MS;
  if (!Number.isSafeInteger(hostOfflineGraceMs) || hostOfflineGraceMs < 1) {
    throw new Error('hostOfflineGraceMs 必须是正安全整数');
  }
  if (!Number.isSafeInteger(roomIdleTtlMs) || roomIdleTtlMs < 1) {
    throw new Error('roomIdleTtlMs 必须是正安全整数');
  }
  const counts = new Map<string, PresenceCounts>();
  const roomOperations = new Map<string, Promise<void>>();

  const enqueueRoomOperation = <T>(roomId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = roomOperations.get(roomId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    roomOperations.set(roomId, tail);
    void tail.finally(() => {
      if (roomOperations.get(roomId) === tail) roomOperations.delete(roomId);
    });
    return result;
  };

  const roomCounts = (roomId: string): PresenceCounts => {
    let current = counts.get(roomId);
    if (!current) {
      current = { users: new Map(), total: 0 };
      counts.set(roomId, current);
    }
    return current;
  };

  const increment = (roomId: string, userId: string): void => {
    const current = roomCounts(roomId);
    current.total += 1;
    current.users.set(userId, (current.users.get(userId) ?? 0) + 1);
  };

  const decrement = (roomId: string, userId: string): void => {
    const current = counts.get(roomId);
    if (!current) return;
    current.total = Math.max(0, current.total - 1);
    const userCount = Math.max(0, (current.users.get(userId) ?? 0) - 1);
    if (userCount === 0) current.users.delete(userId);
    else current.users.set(userId, userCount);
    if (current.total === 0) counts.delete(roomId);
  };

  const syncPresence = async (membership: ResolvedArenaRoomMembership): Promise<void> => {
    const state = membership.actor.getSnapshot();
    if (!state || state.lifecycle.status === 'closed') return;
    const currentCounts = counts.get(membership.roomId);
    const host = state.snapshot.members.find((member) => (
      member.role === 'host' && member.membershipState === 'active'
    ));
    if (!host) throw new Error('ROOM_PRESENCE_STATE_INVALID');
    const effectiveNow = Math.max(now(), Date.parse(state.lifecycle.updatedAt));
    const hostPresent = (currentCounts?.users.get(host.userId) ?? 0) > 0;
    const roomPresent = (currentCounts?.total ?? 0) > 0;
    const deadlines = {
      hostOfflineDeadline: hostPresent
        ? null
        : state.deadlines.hostOfflineDeadline
          ?? new Date(effectiveNow + hostOfflineGraceMs).toISOString(),
      roomIdleDeadline: roomPresent
        ? null
        : state.deadlines.roomIdleDeadline
          ?? new Date(effectiveNow + roomIdleTtlMs).toISOString(),
    };
    if (sameDeadlines(state.deadlines, deadlines)) return;
    const timestamp = new Date(effectiveNow).toISOString();
    const result = await membership.actor.execute({
      authority: issueArenaRoomPresenceAuthority({
        roomId: membership.roomId,
        roomEpoch: state.snapshot.roomEpoch,
        deadlines,
        timestamp,
      }),
      command: {
        type: 'sync-presence',
        expectedRoomEpoch: state.snapshot.roomEpoch,
        deadlines,
        timestamp,
      },
    });
    if (!result.ok) throw new Error('ROOM_PRESENCE_CHECKPOINT_REJECTED');
  };

  const sendControlSync = (
    membership: ResolvedArenaRoomMembership,
    peer: RoomWebSocketPeer,
    cursor?: RoomReconnectCursor,
  ): void => {
    const sync = membership.actor.resolveControlSync(cursor?.control);
    const state = membership.actor.getSnapshot();
    if (!state) throw new Error('ROOM_CONTROL_SYNC_STATE_MISSING');
    const projected = sync.events.map((event, index) => projectArenaRoomEventForViewer(
      event,
      state.snapshot,
      membership.member.userId,
      undefined,
      sync.proposalAuthorUserIds?.[index] ?? undefined,
    ));
    for (const event of projected) peer.send(event);
    if (cursor?.story) {
      peer.send({
        protocolVersion: 1,
        type: 'room.resync.required',
        reason: 'replay-unavailable',
      });
    }
  };

  const createConnectionAuthority = (
    claims: RoomTicketClaims,
  ): RoomWebSocketConnectionAuthority => ({
    activate: (peer) => enqueueRoomOperation(claims.roomId, async () => {
      let membership: ResolvedArenaRoomMembership;
      try {
        membership = await options.memberships.resolveActiveByUser({
          roomId: claims.roomId,
          userId: claims.userId,
        });
      } catch {
        peer.close(CLOSE_MEMBERSHIP_REVOKED, 'membership-revoked');
        return {};
      }
      if (membership.roomEpoch !== claims.roomEpoch) {
        peer.close(CLOSE_MEMBERSHIP_REVOKED, 'room-epoch-stale');
        return {};
      }
      increment(claims.roomId, claims.userId);
      try {
        await syncPresence(membership);
      } catch (error) {
        decrement(claims.roomId, claims.userId);
        throw error;
      }

      try {
        membership = await options.memberships.resolveActiveByUser({
          roomId: claims.roomId,
          userId: claims.userId,
        });
      } catch {
        decrement(claims.roomId, claims.userId);
        await syncPresence(membership);
        peer.close(CLOSE_MEMBERSHIP_REVOKED, 'membership-revoked');
        return {};
      }
      if (membership.roomEpoch !== claims.roomEpoch) {
        decrement(claims.roomId, claims.userId);
        await syncPresence(membership);
        peer.close(CLOSE_MEMBERSHIP_REVOKED, 'room-epoch-stale');
        return {};
      }

      let disposed = false;
      let unsubscribe: (() => void) | undefined;
      try {
        unsubscribe = membership.actor.subscribe((fanout) => {
          if (disposed) return;
          if (fanout.terminal === 'fenced') {
            peer.close(CLOSE_ROOM_AUTHORITY_UNAVAILABLE, 'room-authority-fenced');
            return;
          }
          let closeCode: number | undefined;
          let closeReason: string | undefined;
          for (const event of fanout.events) {
            peer.send(projectArenaRoomEventForViewer(
              event,
              fanout.snapshot,
              claims.userId,
              fanout.predecessorSnapshot,
            ) as RoomServerTransportMessage);
            if (
              event.type === 'room.member.left'
              && event.payload.member.userId === claims.userId
            ) {
              closeCode = CLOSE_MEMBERSHIP_REVOKED;
              closeReason = 'membership-revoked';
            } else if (event.type === 'room.closing') {
              closeCode = CLOSE_ROOM_TERMINAL;
              closeReason = 'room-closed';
            }
          }
          if (closeCode !== undefined && closeReason) peer.close(closeCode, closeReason);
        });
        sendControlSync(membership, peer, claims.reconnect);
      } catch (error) {
        unsubscribe?.();
        decrement(claims.roomId, claims.userId);
        await syncPresence(membership);
        throw error;
      }

      const connection: RoomWebSocketConnection = {
        onMessage: async (message: RoomClientTransportMessage) => {
          if (disposed || message.type !== 'room.resync.request') return;
          let current: ResolvedArenaRoomMembership;
          try {
            current = await options.memberships.resolveActiveByUser({
              roomId: claims.roomId,
              userId: claims.userId,
            });
          } catch {
            peer.close(CLOSE_MEMBERSHIP_REVOKED, 'membership-revoked');
            return;
          }
          if (current.roomEpoch !== claims.roomEpoch) {
            peer.close(CLOSE_MEMBERSHIP_REVOKED, 'room-epoch-stale');
            return;
          }
          sendControlSync(current, peer, message.cursor);
        },
        dispose: () => enqueueRoomOperation(claims.roomId, async () => {
          if (disposed) return;
          disposed = true;
          unsubscribe?.();
          decrement(claims.roomId, claims.userId);
          await syncPresence(membership);
        }),
      };
      return connection;
    }),
  });

  return Object.freeze({
    async issue(input) {
      const membership = await options.memberships.resolveActiveByAccount({
        roomId: input.roomId,
        accountUserId: input.accountUserId,
      });
      return options.tickets.issue({
        roomId: membership.roomId,
        roomEpoch: membership.roomEpoch,
        userId: membership.member.userId,
        roleHint: membership.member.role,
        ...(input.reconnect === undefined ? {} : { reconnect: input.reconnect }),
      });
    },

    async authorize(request) {
      let token: string;
      try {
        const params = new URL(request.url).searchParams;
        const values = params.getAll('ticket');
        const keys = [...params.keys()];
        if (values.length === 0) return rejected(401, 'ROOM_TICKET_REQUIRED');
        if (values.length !== 1 || keys.some((key) => key !== 'ticket')) {
          return rejected(401, 'ROOM_TICKET_INVALID');
        }
        [token] = values;
      } catch {
        return rejected(401, 'ROOM_TICKET_INVALID');
      }
      let claims: RoomTicketClaims | null;
      try {
        claims = await options.tickets.verify(token);
      } catch {
        return rejected(503, 'ROOM_TICKET_AUTH_UNAVAILABLE');
      }
      if (!claims) return rejected(401, 'ROOM_TICKET_INVALID');
      let membership: ResolvedArenaRoomMembership;
      try {
        membership = await options.memberships.resolveActiveByUser({
          roomId: claims.roomId,
          userId: claims.userId,
        });
      } catch (error) {
        if (error instanceof ArenaRoomMembershipError) return rejected(403, error.code);
        return rejected(503, 'ROOM_TICKET_AUTH_UNAVAILABLE');
      }
      if (membership.roomEpoch !== claims.roomEpoch) {
        return rejected(403, 'ROOM_TICKET_EPOCH_STALE');
      }
      if (membership.member.role !== claims.roleHint) {
        return rejected(403, 'ROOM_TICKET_ROLE_STALE');
      }
      try {
        const consumed = await options.replay.consume({
          jti: claims.jti,
          nowMs: Math.floor(now()),
          expiresAtMs: claims.exp * 1_000,
        });
        if (consumed.kind === 'replayed') return rejected(401, 'ROOM_TICKET_REPLAYED');
      } catch {
        return rejected(503, 'ROOM_TICKET_AUTH_UNAVAILABLE');
      }
      return {
        accepted: true,
        connectionKey: `account:${membership.accountUserId}`,
        roomId: membership.roomId,
        userId: membership.member.userId,
        role: membership.member.role,
        connectionAuthority: createConnectionAuthority(claims),
      };
    },
  });
};
