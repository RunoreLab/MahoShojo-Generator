import { describe, expect, it, vi } from 'vitest';

import {
  ArenaDataCardRefVerifierError,
  type ArenaDataCardRefVerifier,
} from '#/arena-room/arena-data-card-ref-verifier';
import {
  ArenaRoomGenerationPresetResolverError,
  type ArenaRoomGenerationPresetResolver,
} from '#/arena-room/room-generation-preset-registry';
import type { ArenaRoomGenerationCanonicalContent } from '#/arena-room/room-generation-materializer';
import { MAX_ROOM_MEMBERS } from '@mahoshojo/contracts/arena-room';
import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';
import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import {
  ArenaRoomMembershipError,
  createArenaRoomMembershipService,
} from '#/arena-room/room-membership-service';
import type { RoomDirectoryRecord } from '#/arena-room/room-directory-record';
import {
  createArenaRoomState,
  createTestArenaDataCardRefVerifier,
} from './arena-room-fixtures';

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;
  directories: Array<RoomDirectoryRecord | undefined> = [];
  receipts = new Map<string, { requestDigest: string; roomId: string }>();
  throwAfterSaveOnce = false;

  async loadCreationReceipt(input: { accountUserId: number; creationRequestId: string }) {
    return this.receipts.get(`${input.accountUserId}:${input.creationRequestId}`) ?? null;
  }

  async load(roomId: string) {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    const data = consumeArenaRoomCheckpointCommit(input.commit);
    const receiptKey = input.creationReceipt === undefined
      ? null
      : `${input.creationReceipt.accountUserId}:${input.creationReceipt.creationRequestId}`;
    if (receiptKey !== null && this.receipts.has(receiptKey)) {
      throw new Error('REDIS_ROOM_CREATION_RECEIPT_CONFLICT');
    }
    this.directories.push(input.directory === undefined
      ? undefined
      : structuredClone(input.directory));
    if (data.predecessor === null) {
      if (this.state !== null) return { kind: 'conflict' as const };
    } else if (
      this.state === null
      || JSON.stringify(this.state) !== JSON.stringify(data.predecessorState)
      || JSON.stringify(checkpointPredecessorOf(this.state)) !== JSON.stringify(data.predecessor)
    ) return { kind: 'conflict' as const };
    this.state = structuredClone(data.nextState);
    if (receiptKey !== null && input.creationReceipt !== undefined) {
      this.receipts.set(receiptKey, {
        requestDigest: input.creationReceipt.requestDigest,
        roomId: data.nextState.snapshot.roomId,
      });
    }
    if (this.throwAfterSaveOnce) {
      this.throwAfterSaveOnce = false;
      throw new Error('redis reply lost');
    }
    return { kind: 'saved' as const };
  }

  async refresh() {
    return { kind: 'refreshed' as const };
  }
}

const presetConfig = () => ({
  ...createArenaRoomState().snapshot.sharedConfig,
  combatants: [{
    key: 'preset:M00_white_lily.json',
    ref: {
      id: 'M00_white_lily.json',
      kind: 'character' as const,
      versionToken: `sha256:${'1'.repeat(64)}`,
    },
  }],
});

const createPresetResolver = (
  errorCode?: ConstructorParameters<typeof ArenaRoomGenerationPresetResolverError>[0],
): ArenaRoomGenerationPresetResolver => ({
  resolve: vi.fn(async ({ ref }): Promise<ArenaRoomGenerationCanonicalContent> => {
    if (errorCode) throw new ArenaRoomGenerationPresetResolverError(errorCode);
    return {
      ref,
      payload: { codename: '白百合' },
      displayName: '白百合',
      sourceType: 'character',
    };
  }),
});

const createHarness = (
  references: ArenaDataCardRefVerifier | null = createTestArenaDataCardRefVerifier(),
  presets?: ArenaRoomGenerationPresetResolver,
) => {
  const store = new MemoryRoomStore();
  let userIndex = 0;
  let nowIndex = 0;
  const timestamps = [
    '2026-08-28T00:00:00.000Z',
    '2026-08-28T00:01:00.000Z',
    '2026-08-28T00:02:00.000Z',
    '2026-08-28T00:03:00.000Z',
    '2026-08-28T00:04:00.000Z',
  ];
  const registry = createRoomActorRegistry({
    store,
    createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
    createTimestamp: () => timestamps[0]!,
    now: () => Date.parse(timestamps[Math.min(nowIndex, timestamps.length - 1)]!),
  });
  const service = createArenaRoomMembershipService({
    actors: registry,
    creationReceipts: store,
    ...(references === null ? {} : { references }),
    ...(presets === undefined ? {} : { presets }),
    createUserId: () => `server-user-${++userIndex}`,
    now: () => timestamps[Math.min(++nowIndex, timestamps.length - 1)]!,
  });
  return { registry, service, store };
};

describe('Arena Room membership service', () => {
  it('允许以空角色草稿创建房间，并允许未签名的 host-local 角色按普通模式准入', async () => {
    const emptyHarness = createHarness();
    const emptyConfig = {
      ...createArenaRoomState().snapshot.sharedConfig,
      combatants: [],
    };
    await expect(emptyHarness.service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: emptyConfig,
    })).resolves.toMatchObject({
      snapshot: { sharedConfig: { combatants: [] } },
    });

    const localHarness = createHarness();
    const localConfig = {
      ...createArenaRoomState().snapshot.sharedConfig,
      battleMode: 'daily' as const,
      combatants: [{
        key: 'host-local:character:unsigned',
        displayName: '未签名本地角色',
        type: 'general-character' as const,
        source: 'host-local' as const,
      }],
    };
    await expect(localHarness.service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: localConfig,
    })).resolves.toMatchObject({
      snapshot: { sharedConfig: { combatants: localConfig.combatants } },
    });
  });

  it('create 在 canonical ref 复验失败时不创建房间', async () => {
    const references: ArenaDataCardRefVerifier = {
      verify: vi.fn(async () => {
        throw new ArenaDataCardRefVerifierError('ARENA_DATA_CARD_REF_NOT_READABLE');
      }),
    };
    const { service, store } = createHarness(references);

    await expect(service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    })).rejects.toEqual(new ArenaRoomMembershipError('ROOM_REFERENCE_DENIED'));

    expect(references.verify).toHaveBeenCalledWith({
      refs: [{ id: 'character-1', kind: 'character', versionToken: 'v1' }],
      hostAccountUserId: 101,
    });
    expect(store.state).toBeNull();
  });

  it('Shared Config 含 online ref 但未注入 verifier 时 fail closed', async () => {
    const { service, store } = createHarness(null);

    await expect(service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    })).rejects.toEqual(new ArenaRoomMembershipError('ROOM_REFERENCE_UNAVAILABLE'));
    expect(store.state).toBeNull();
  });

  it('create 在 checkpoint 前用 server-known resolver exact 验证 preset ref', async () => {
    const presets = createPresetResolver();
    const { service, store } = createHarness(undefined, presets);

    await expect(service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: presetConfig(),
    })).resolves.toMatchObject({ roomId: 'room-1' });

    expect(presets.resolve).toHaveBeenCalledWith({ ref: presetConfig().combatants[0]!.ref });
    expect(store.state?.snapshot.sharedConfig).toEqual(presetConfig());
  });

  it.each([
    ['stale', 'ARENA_ROOM_PRESET_VERSION_MISMATCH', 'ROOM_REFERENCE_STALE'],
    ['not found', 'ARENA_ROOM_PRESET_NOT_FOUND', 'ROOM_REFERENCE_STALE'],
  ] as const)('create 在 preset %s 时不写入 checkpoint', async (_label, errorCode, expectedCode) => {
    const presets = createPresetResolver(errorCode);
    const { service, store } = createHarness(undefined, presets);

    await expect(service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: presetConfig(),
    })).rejects.toEqual(new ArenaRoomMembershipError(expectedCode));

    expect(store.state).toBeNull();
  });

  it('Shared Config 含 preset ref 但未注入 resolver 时 fail closed', async () => {
    const { service, store } = createHarness();

    await expect(service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: presetConfig(),
    })).rejects.toEqual(new ArenaRoomMembershipError('ROOM_REFERENCE_UNAVAILABLE'));

    expect(store.state).toBeNull();
  });

  it('只暴露安全 session snapshot，host close 使用固定 lifecycle seam', async () => {
    const { service, store } = createHarness();
    const created = await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });

    const session = await service.getSession({
      roomId: created.roomId,
      accountUserId: 101,
    });
    expect(session).toMatchObject({
      roomId: created.roomId,
      roomEpoch: created.roomEpoch,
      member: { role: 'host' },
      snapshot: { roomId: created.roomId, members: [{ role: 'host' }] },
    });
    expect(Object.keys(session).sort()).toEqual(['member', 'roomEpoch', 'roomId', 'snapshot']);
    await expect(service.close({
      roomId: created.roomId,
      accountUserId: 101,
      expectedRoomEpoch: created.roomEpoch,
    })).resolves.toMatchObject({ member: { role: 'host' } });
    expect(store.state?.lifecycle.status).toBe('closed');
    await expect(service.close({
      roomId: created.roomId,
      accountUserId: 101,
      expectedRoomEpoch: created.roomEpoch,
    })).resolves.toMatchObject({ member: { role: 'host' } });
  });

  it('member 不能调用 host close seam', async () => {
    const { service } = createHarness();
    const created = await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    await service.join({
      roomId: created.roomId,
      accountUserId: 202,
      displayName: 'Member',
    });

    await expect(service.close({
      roomId: created.roomId,
      accountUserId: 202,
      expectedRoomEpoch: created.roomEpoch,
    })).rejects.toMatchObject({ code: 'ROOM_PERMISSION_DENIED' });
  });

  it('create 的 room/user/role/joinedAt 都由 server-owned service 归一化', async () => {
    const { service } = createHarness();
    const created = await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });

    expect(created).toMatchObject({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      member: {
        userId: 'server-user-1',
        role: 'host',
        displayName: 'Host',
        membershipState: 'active',
        joinedAt: '2026-08-28T00:00:00.000Z',
      },
    });
  });

  it('create 将 public directory record 与 checkpoint 一次性交给 Redis store', async () => {
    const store = new MemoryRoomStore();
    const preparedRegistry = createRoomActorRegistry({
      store,
      createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
      createTimestamp: () => '2026-08-28T00:00:00.000Z',
      now: () => Date.parse('2026-08-28T00:00:00.000Z'),
    });
    const service = createArenaRoomMembershipService({
      actors: preparedRegistry,
      createUserId: () => 'host-1',
      references: createTestArenaDataCardRefVerifier(),
    });

    await expect(service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
      directory: { title: '公开测试房', visibility: 'public' },
    })).resolves.toMatchObject({ roomId: 'room-1', roomEpoch: 'epoch-1' });
    expect(store.directories).toEqual([{
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      hostUserId: 101,
      title: '公开测试房',
      visibility: 'public',
      status: 'open',
      createdAt: '2026-08-28T00:00:00.000Z',
      lastActivityAt: '2026-08-28T00:00:00.000Z',
    }]);
    expect(store.state?.lifecycle.status).toBe('open');
  });

  it('unlisted create 响应丢失后以同一请求 ID 恢复，且不会创建 replacement Room', async () => {
    const { service, store } = createHarness();
    store.throwAfterSaveOnce = true;
    const request = {
      accountUserId: 101,
      creationRequestId: 'create-request-1234',
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
      directory: { title: '非公开测试房', visibility: 'unlisted' as const },
    };

    await expect(service.create(request)).rejects.toThrow('redis reply lost');
    await expect(service.hasCreationReceipt({
      accountUserId: 101,
      creationRequestId: 'create-request-1234',
    })).resolves.toBe(true);
    const recovered = await service.create(request);

    expect(recovered).toMatchObject({ roomId: 'room-1', member: { role: 'host' } });
    expect(store.receipts.size).toBe(1);
    expect(store.directories.filter((record) => record !== undefined)).toHaveLength(1);
  });

  it('同一创建请求 ID 绑定 canonical intent，payload 变化或 receipt 悬空时返回 conflict', async () => {
    const { service, store } = createHarness();
    const request = {
      accountUserId: 101,
      creationRequestId: 'create-request-1234',
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
      directory: { title: '公开测试房', visibility: 'public' as const },
    };
    await service.create(request);

    await expect(service.create({ ...request, displayName: 'Changed' }))
      .rejects.toMatchObject({ code: 'ROOM_CREATION_REQUEST_CONFLICT' });
    store.state = null;
    const recoveredRegistry = createRoomActorRegistry({ store });
    const recoveredService = createArenaRoomMembershipService({
      actors: recoveredRegistry,
      creationReceipts: store,
    });
    await expect(recoveredService.create(request))
      .rejects.toMatchObject({ code: 'ROOM_CREATION_REQUEST_CONFLICT' });
  });

  it('HTTP 已观察到 receipt 后若它在二次读取前到期，也不能绕过日预算创建 replacement', async () => {
    const { service, store } = createHarness();
    const request = {
      accountUserId: 101,
      creationRequestId: 'create-request-1234',
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
      directory: { title: '非公开测试房', visibility: 'unlisted' as const },
    };
    await service.create(request);
    store.receipts.clear();

    await expect(service.create({
      ...request,
      requireExistingCreationReceipt: true,
    })).rejects.toMatchObject({ code: 'ROOM_CREATION_REQUEST_CONFLICT' });
    expect(store.state?.snapshot.roomId).toBe('room-1');
    expect(store.directories.filter((record) => record !== undefined)).toHaveLength(1);
  });

  it('同一 account multi-tab join 复用一个 membership，不重复 member', async () => {
    const { service, store } = createHarness();
    await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const first = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    const second = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Untrusted rename',
    });

    expect(second).toEqual(first);
    expect(store.state?.snapshot.members).toHaveLength(2);
    expect(store.state?.memberAuthority.filter((entry) => entry.accountUserId === 202))
      .toHaveLength(1);
  });

  it('房间成员达到上限时返回独立容量错误，不伪装成普通状态冲突', async () => {
    const { service, store } = createHarness();
    await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    for (let index = 0; index < MAX_ROOM_MEMBERS - 1; index += 1) {
      await service.join({
        roomId: 'room-1',
        accountUserId: 200 + index,
        displayName: `Member ${index + 1}`,
      });
    }

    await expect(service.join({
      roomId: 'room-1',
      accountUserId: 999,
      displayName: 'Overflow',
    })).rejects.toMatchObject({ code: 'ROOM_MEMBER_LIMIT_REACHED' });
    expect(store.state?.snapshot.members).toHaveLength(MAX_ROOM_MEMBERS);
  });

  it('session snapshot 只向 host 暴露全部 Proposal，member 只能看到自己的 Proposal', async () => {
    const { registry, service } = createHarness();
    const host = await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const author = await service.join({
      roomId: host.roomId,
      accountUserId: 202,
      displayName: 'Author',
    });
    await service.join({
      roomId: host.roomId,
      accountUserId: 303,
      displayName: 'Other',
    });
    const actor = registry.get(host.roomId);
    if (!actor) throw new Error('actor missing');
    const submitted = await actor.execute({
      authority: {
        kind: 'authenticated-user',
        actorUserId: author.member.userId,
        accountUserId: 202,
      },
      command: {
        type: 'submit-proposal',
        expectedRoomEpoch: host.roomEpoch,
        timestamp: '2026-08-28T00:04:00.000Z',
        proposal: {
          proposalVersion: 1,
          proposalId: 'proposal-private',
          roomId: host.roomId,
          authorUserId: author.member.userId,
          baseRevision: 0,
          status: 'submitted',
          changes: [{
            changeId: 'guidance-1',
            type: 'setUserGuidance',
            value: '仅作者与房主可见',
            expectedBase: { kind: 'value', value: '' },
          }],
          createdAt: '2026-08-28T00:04:00.000Z',
        },
      },
    });
    expect(submitted.ok).toBe(true);

    const [hostSession, authorSession, otherSession] = await Promise.all([
      service.getSession({ roomId: host.roomId, accountUserId: 101 }),
      service.getSession({ roomId: host.roomId, accountUserId: 202 }),
      service.getSession({ roomId: host.roomId, accountUserId: 303 }),
    ]);
    expect(hostSession.snapshot.proposals.map((proposal) => proposal.proposalId))
      .toEqual(['proposal-private']);
    expect(authorSession.snapshot.proposals.map((proposal) => proposal.proposalId))
      .toEqual(['proposal-private']);
    expect(otherSession.snapshot.proposals).toEqual([]);
  });

  it('member leave/kick revokes durable membership，host explicit leave closes room', async () => {
    const { service, store } = createHarness();
    const host = await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const member = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    await service.kick({
      roomId: 'room-1',
      accountUserId: 101,
      targetUserId: member.member.userId,
      expectedRoomEpoch: host.roomEpoch,
    });
    expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202))
      .toMatchObject({ revocationReason: 'kicked' });
    await expect(service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    })).rejects.toMatchObject({ code: 'ROOM_MEMBERSHIP_KICKED' });

    await service.leave({
      roomId: host.roomId,
      accountUserId: 101,
      expectedRoomEpoch: host.roomEpoch,
    });
    expect(store.state?.lifecycle).toMatchObject({ status: 'closed' });
  });

  it('自愿离开后可重新加入同一房间，沿用原身份并刷新显示名与 joinedAt', async () => {
    const { service, store } = createHarness();
    await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const first = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    await service.leave({ roomId: 'room-1', accountUserId: 202, expectedRoomEpoch: 'epoch-1' });
    expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202))
      .toMatchObject({ revocationReason: 'left' });

    const rejoined = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Rejoined Member',
    });

    expect(rejoined.member).toMatchObject({
      userId: first.member.userId,
      role: 'member',
      displayName: 'Rejoined Member',
      membershipState: 'active',
    });
    expect(rejoined.member.joinedAt).not.toBe(first.member.joinedAt);
    expect(store.state?.snapshot.members).toHaveLength(2);
    expect(store.state?.memberAuthority).toHaveLength(2);
    expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202))
      .toMatchObject({ member: { membershipState: 'active' } });
    expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202))
      .not.toHaveProperty('revocationReason');
  });

  it('重进后离开前的 pending proposal 不会复活', async () => {
    const { registry, service } = createHarness();
    const host = await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const author = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Author',
    });
    const actor = registry.get('room-1');
    if (!actor) throw new Error('actor missing');
    const submitted = await actor.execute({
      authority: {
        kind: 'authenticated-user',
        actorUserId: author.member.userId,
        accountUserId: 202,
      },
      command: {
        type: 'submit-proposal',
        expectedRoomEpoch: host.roomEpoch,
        timestamp: '2026-08-28T00:04:00.000Z',
        proposal: {
          proposalVersion: 1,
          proposalId: 'proposal-orphan',
          roomId: 'room-1',
          authorUserId: author.member.userId,
          baseRevision: 0,
          status: 'submitted',
          changes: [{
            changeId: 'guidance-1',
            type: 'setUserGuidance',
            value: '离开前提交',
            expectedBase: { kind: 'value', value: '' },
          }],
          createdAt: '2026-08-28T00:04:00.000Z',
        },
      },
    });
    expect(submitted.ok).toBe(true);

    await service.leave({ roomId: 'room-1', accountUserId: 202, expectedRoomEpoch: 'epoch-1' });
    const rejoined = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Author',
    });

    expect(rejoined.snapshot.proposals).toEqual([]);
    expect(registry.get('room-1')?.getSnapshot()?.terminalProposalIds).toContain('proposal-orphan');
  });

  it('leave 后被房主补踢则升级为 kicked，join 永久拒绝；kick 后重复 leave 也无法恢复', async () => {
    const { service, store } = createHarness();
    const host = await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const member = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });

    await service.leave({ roomId: 'room-1', accountUserId: 202, expectedRoomEpoch: 'epoch-1' });
    await service.kick({
      roomId: 'room-1',
      accountUserId: 101,
      targetUserId: member.member.userId,
      expectedRoomEpoch: host.roomEpoch,
    });
    expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202))
      .toMatchObject({ revocationReason: 'kicked' });
    await expect(service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    })).rejects.toMatchObject({ code: 'ROOM_MEMBERSHIP_KICKED' });

    await service.leave({ roomId: 'room-1', accountUserId: 202, expectedRoomEpoch: 'epoch-1' });
    expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202))
      .toMatchObject({ revocationReason: 'kicked' });
    await expect(service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    })).rejects.toMatchObject({ code: 'ROOM_MEMBERSHIP_KICKED' });
  });

  it('重进重新占用成员容量额度，房间满员时拒绝重进', async () => {
    const { service, store } = createHarness();
    await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const leaver = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Leaver',
    });
    for (let index = 0; index < MAX_ROOM_MEMBERS - 2; index += 1) {
      await service.join({
        roomId: 'room-1',
        accountUserId: 300 + index,
        displayName: `Filler ${index + 1}`,
      });
    }
    await service.leave({ roomId: 'room-1', accountUserId: 202, expectedRoomEpoch: 'epoch-1' });
    expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202)?.member.userId)
      .toBe(leaver.member.userId);
    await service.join({
      roomId: 'room-1',
      accountUserId: 999,
      displayName: 'Backfill',
    });

    await expect(service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Leaver',
    })).rejects.toMatchObject({ code: 'ROOM_MEMBER_LIMIT_REACHED' });
  });

  it('legacy 无 reason 的 revoked tombstone 保持 fail-closed，不能重进', async () => {
    const { service, store } = createHarness();
    await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    await service.join({ roomId: 'room-1', accountUserId: 202, displayName: 'Member' });
    await service.leave({ roomId: 'room-1', accountUserId: 202, expectedRoomEpoch: 'epoch-1' });
    const record = store.state?.memberAuthority.find((entry) => entry.accountUserId === 202);
    if (!record || !('revocationReason' in record)) throw new Error('missing tombstone');
    delete record.revocationReason;

    const recoveredRegistry = createRoomActorRegistry({
      store,
      now: () => Date.parse('2026-08-28T00:02:00.000Z'),
    });
    const recoveredService = createArenaRoomMembershipService({
      actors: recoveredRegistry,
      creationReceipts: store,
    });
    await expect(recoveredService.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    })).rejects.toMatchObject({ code: 'ROOM_MEMBERSHIP_REVOKED' });
  });

  it('kick 以 server host authority 与 epoch fence 决策，禁止 self/host 并对重复撤销幂等', async () => {
    const { service } = createHarness();
    const host = await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const member = await service.join({
      roomId: host.roomId,
      accountUserId: 202,
      displayName: 'Member',
    });

    await expect(service.kick({
      roomId: host.roomId,
      accountUserId: 202,
      targetUserId: host.member.userId,
      expectedRoomEpoch: 'epoch-stale',
    })).rejects.toMatchObject({ code: 'ROOM_PERMISSION_DENIED' });
    await expect(service.kick({
      roomId: host.roomId,
      accountUserId: 101,
      targetUserId: member.member.userId,
      expectedRoomEpoch: 'epoch-stale',
    })).rejects.toMatchObject({ code: 'ROOM_EPOCH_STALE' });
    await expect(service.kick({
      roomId: host.roomId,
      accountUserId: 101,
      targetUserId: host.member.userId,
      expectedRoomEpoch: host.roomEpoch,
    })).rejects.toMatchObject({ code: 'ROOM_PERMISSION_DENIED' });

    const kicked = await service.kick({
      roomId: host.roomId,
      accountUserId: 101,
      targetUserId: member.member.userId,
      expectedRoomEpoch: host.roomEpoch,
    });
    const duplicate = await service.kick({
      roomId: host.roomId,
      accountUserId: 101,
      targetUserId: member.member.userId,
      expectedRoomEpoch: host.roomEpoch,
    });

    expect(kicked).toMatchObject({
      member: { userId: host.member.userId, role: 'host', membershipState: 'active' },
      snapshot: { members: [{ userId: host.member.userId }] },
    });
    expect(duplicate).toEqual(kicked);
  });

  it('普通 member 显式 leave 不受 socket 数量影响，重复 leave 幂等', async () => {
    const { service, store } = createHarness();
    await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    await service.join({ roomId: 'room-1', accountUserId: 202, displayName: 'Member' });

    await service.leave({ roomId: 'room-1', accountUserId: 202, expectedRoomEpoch: 'epoch-1' });
    await service.leave({ roomId: 'room-1', accountUserId: 202, expectedRoomEpoch: 'epoch-1' });
    expect(store.state?.lifecycle.status).toBe('open');
    expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202)?.member)
      .toMatchObject({ membershipState: 'revoked' });
  });

  it('absent checkpoint / invalid account fail closed，join 不会隐式 create Room', async () => {
    const { service, store } = createHarness();

    await expect(service.join({
      roomId: 'room-missing',
      accountUserId: 202,
      displayName: 'Member',
    })).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
    await expect(service.create({
      accountUserId: 0,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    })).rejects.toBeInstanceOf(ArenaRoomMembershipError);
    expect(store.state).toBeNull();
  });

  it('旧 epoch 的延迟 leave/close 不能作用于 recovery 后的新 incarnation', async () => {
    const store = new MemoryRoomStore();
    const originalRegistry = createRoomActorRegistry({
      store,
      createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
      createTimestamp: () => '2026-08-28T00:00:00.000Z',
      now: () => Date.parse('2026-08-28T00:00:00.000Z'),
    });
    const original = createArenaRoomMembershipService({
      actors: originalRegistry,
      references: createTestArenaDataCardRefVerifier(),
      createUserId: () => 'host-1',
    });
    await original.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const recoveredRegistry = createRoomActorRegistry({
      store,
      createRoomEpoch: () => 'epoch-2',
      recoveryTimestamp: () => '2026-08-28T00:01:00.000Z',
      now: () => Date.parse('2026-08-28T00:01:00.000Z'),
    });
    await recoveredRegistry.recover('room-1');
    const recovered = createArenaRoomMembershipService({ actors: recoveredRegistry });

    await expect(recovered.leave({
      roomId: 'room-1',
      accountUserId: 101,
      expectedRoomEpoch: 'epoch-1',
    })).rejects.toMatchObject({ code: 'ROOM_EPOCH_STALE' });
    await expect(recovered.close({
      roomId: 'room-1',
      accountUserId: 101,
      expectedRoomEpoch: 'epoch-1',
    })).rejects.toMatchObject({ code: 'ROOM_EPOCH_STALE' });
    expect(store.state).toMatchObject({
      lifecycle: { status: 'open' },
      snapshot: { roomEpoch: 'epoch-2' },
    });
  });

  it('lazy membership resolution 在 deadline 到期后先权威关闭，reconnect 不能清除期限', async () => {
    const store = new MemoryRoomStore();
    let now = '2026-08-28T00:00:00.000Z';
    const registry = createRoomActorRegistry({
      store,
      createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
      createTimestamp: () => now,
      now: () => Date.parse(now),
    });
    const service = createArenaRoomMembershipService({
      actors: registry,
      createUserId: () => 'host-1',
      now: () => now,
      references: createTestArenaDataCardRefVerifier(),
    });
    await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    now = '2026-08-28T00:45:00.000Z';

    await expect(service.resolveActiveByAccount({ roomId: 'room-1', accountUserId: 101 }))
      .rejects.toMatchObject({ code: 'ROOM_CLOSED' });
    expect(store.state?.lifecycle).toMatchObject({
      status: 'closed',
      closeReason: 'host-offline-timeout',
    });
  });
});
