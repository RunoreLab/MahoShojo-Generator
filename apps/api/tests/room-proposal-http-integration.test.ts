import { describe, expect, it, vi } from 'vitest';

import { createHonoApp } from '#/app';
import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import { createArenaRoomMembershipService } from '#/arena-room/room-membership-service';
import { createArenaRoomProposalService } from '#/arena-room/room-proposal-service';
import type { HonoServerConfig } from '#/config';
import type { RedisService } from '#/redis/runtime';
import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';

import { createArenaRoomState } from './arena-room-fixtures';

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;

  async load(roomId: string) {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    const data = consumeArenaRoomCheckpointCommit(input.commit);
    if (data.predecessor === null) {
      if (this.state !== null) return { kind: 'conflict' as const };
    } else if (
      this.state === null
      || JSON.stringify(this.state) !== JSON.stringify(data.predecessorState)
      || JSON.stringify(checkpointPredecessorOf(this.state)) !== JSON.stringify(data.predecessor)
    ) return { kind: 'conflict' as const };
    this.state = structuredClone(data.nextState);
    return { kind: 'saved' as const };
  }

  async refresh() {
    return { kind: 'refreshed' as const };
  }
}

const config: HonoServerConfig = {
  arenaMultiplayerEnabled: true,
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  redisUrl: 'redis://127.0.0.1:6379',
  redisKeyPrefix: 'test',
  redisRequired: true,
  d1Required: false,
  corsOrigins: ['http://localhost:3000'],
  arenaRoomAllowedOrigins: ['http://localhost:3000'],
  authMode: 'hybrid',
};

const redis: RedisService = {
  connect: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  getStatus: vi.fn(() => ({
    configured: true,
    connected: true,
    ready: true,
    lastError: null,
  })),
  ping: vi.fn(async () => true),
  consumeFixedWindow: vi.fn(async () => ({
    allowed: true,
    limit: 600,
    remaining: 599,
    retryAfterSeconds: 1,
  })),
};

const post = (body: Record<string, unknown>) => ({
  method: 'POST',
  headers: {
    authorization: 'Bearer integration-user',
    'content-type': 'application/json',
    origin: 'http://localhost:3000',
  },
  body: JSON.stringify(body),
});

describe('Arena Proposal Hono authority composition', () => {
  it('real HTTP -> membership -> proposal service -> RoomActor closes submit/reject lifecycle', async () => {
    const store = new MemoryRoomStore();
    let userIndex = 0;
    const actors = createRoomActorRegistry({
      store,
      createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
      createTimestamp: () => '2026-08-28T00:00:00.000Z',
      now: () => Date.parse('2026-08-28T00:03:00.000Z'),
    });
    const memberships = createArenaRoomMembershipService({
      actors,
      createUserId: () => `server-user-${++userIndex}`,
      now: () => '2026-08-28T00:01:00.000Z',
    });
    const host = await memberships.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const member = await memberships.join({
      roomId: host.roomId,
      accountUserId: 202,
      displayName: 'Member',
    });
    const references = { verify: vi.fn(async (input) => input.refs) };
    const proposals = createArenaRoomProposalService({
      memberships,
      references,
      now: () => '2026-08-28T00:02:00.000Z',
    });
    let accountUserId = 202;
    const app = createHonoApp(config, redis, undefined, {
      arenaRoom: {
        resolveAuthentication: vi.fn(async () => ({
          status: 'authenticated' as const,
          userId: accountUserId,
        })),
        memberships,
        proposals,
        generations: {
          cancel: vi.fn(async () => { throw new Error('not used'); }),
          start: vi.fn(async () => { throw new Error('not used'); }),
          read: vi.fn(async () => { throw new Error('not used'); }),
        },
        configs: {
          publish: vi.fn(async () => { throw new Error('not used'); }),
        },
        directory: { discoverPublic: vi.fn(async () => ({ items: [], nextCursor: null })) },
        websocketAuthority: { issue: vi.fn(async () => 'ticket') },
        rateLimit: vi.fn(async () => ({
          allowed: true,
          limit: 30,
          remaining: 29,
          retryAfterSeconds: 1,
        })),
      },
    });
    const proposalId = 'proposal-http-real';
    const submit = await app.request(`/api/arena/rooms/v1/${host.roomId}/proposals`, post({
      proposalId,
      expectedRoomEpoch: host.roomEpoch,
      baseRevision: 0,
      changes: [{
        changeId: 'guidance-1',
        type: 'setUserGuidance',
        value: '成员建议',
        expectedBase: { kind: 'value', value: '' },
      }],
    }));

    expect(submit.status).toBe(200);
    expect(await submit.json()).toMatchObject({
      proposalId,
      status: 'submitted',
      revision: 0,
    });
    expect(store.state?.snapshot.proposals).toMatchObject([{
      proposalId,
      authorUserId: member.member.userId,
      status: 'submitted',
    }]);

    accountUserId = 101;
    const resolve = await app.request(
      `/api/arena/rooms/v1/${host.roomId}/proposals/${proposalId}/resolve`,
      post({
        expectedRoomEpoch: host.roomEpoch,
        expectedRevision: 0,
        resolution: 'reject',
      }),
    );

    expect(resolve.status).toBe(200);
    expect(await resolve.json()).toMatchObject({
      proposalId,
      status: 'rejected',
      revision: 0,
    });
    expect(store.state?.snapshot.proposals).toEqual([]);
    expect(store.state?.terminalProposalIds).toContain(proposalId);
    expect(store.state?.snapshot.sharedConfig.userGuidance).toBe('');
  });
});
