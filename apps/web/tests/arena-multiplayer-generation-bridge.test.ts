import { describe, expect, it, vi } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import {
  dispatchArenaRoomGenerationStart,
  dispatchArenaRoomGenerationRetry,
  resolveArenaRoomGenerationAction,
} from '@/components/arena/multiplayer/generation-bridge';
import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';

const sharedConfig: ArenaRoomSharedConfig = {
  battleMode: 'classic',
  combatants: [{
    key: 'host-local:character:1',
    displayName: '角色',
    type: 'magical-girl',
    source: 'host-local',
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'default',
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: {
    readArenaHistory: true,
    readArenaHistoryLimit: 3,
    isArenaHistoryUnlimited: false,
    writeArenaHistory: true,
    readCurrentState: true,
    writeCurrentState: true,
    readNarrativeHistory: false,
    readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false,
    writeNarrativeHistory: false,
  },
};

const stateFor = (
  role: 'host' | 'member',
  generationPhase: ArenaRoomControllerState['generation']['phase'] = 'idle',
): ArenaRoomControllerState => ({
  phase: 'connected',
  rooms: [],
  notice: null,
  error: null,
  unknownOperation: null,
  proposalOperation: null,
  proposalResultUnknown: false,
  session: {
    protocolVersion: 1,
    roomId: 'room-1',
    roomEpoch: 'epoch-1',
    self: {
      userId: role === 'host' ? 'host-1' : 'member-1',
      role,
      displayName: role === 'host' ? '房主' : '成员',
      membershipState: 'active',
    },
    snapshot: {
      protocolVersion: 1,
      schemaVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 4,
      controlSeq: 8,
      sharedConfig,
      members: [],
      proposals: [],
      activeGeneration: null,
    },
  },
  generation: {
    mirror: null,
    phase: generationPhase,
    status: null,
    authoritativeMarkdown: '',
    markdown: '',
    storyCursor: null,
    gap: null,
    finalAuthoritative: false,
    generationRecordId: null,
    errorCode: null,
    pendingRequestId: generationPhase === 'unknown' ? 'request-unknown-1' : null,
    startResultUnknown: generationPhase === 'unknown',
  },
});

describe('Arena multiplayer generation bridge', () => {
  it('成员、运行中与结果未知状态均 fail closed，不允许生成 POST', () => {
    expect(resolveArenaRoomGenerationAction(stateFor('member'))).toMatchObject({
      inRoom: true,
      canStart: false,
      reason: 'member',
    });
    expect(resolveArenaRoomGenerationAction(stateFor('host', 'running'))).toMatchObject({
      inRoom: true,
      canStart: false,
      reason: 'active',
    });
    expect(resolveArenaRoomGenerationAction(stateFor('host', 'unknown'))).toMatchObject({
      inRoom: true,
      canStart: false,
      canRetry: true,
      reason: 'recovery',
    });
  });

  it('房主只向 controller 提交一次完整请求，不把 secret 写入 Room state', async () => {
    const state = stateFor('host');
    const before = JSON.stringify(state);
    const startGeneration = vi.fn(async () => {});
    const controller = {
      getSnapshot: () => state,
      startGeneration,
    } as unknown as ArenaRoomController;
    const generation = {
      generationRequestId: 'request-stable-1',
      combatants: [{ data: { name: '角色' } }],
      customProvider: { apiKey: 'secret-must-stay-transient' },
    };

    const outcome = await dispatchArenaRoomGenerationStart({
      controller,
      state,
      sharedConfig,
      generationRequestId: 'request-stable-1',
      generation,
    });

    expect(outcome).toBe('submitted');
    expect(startGeneration).toHaveBeenCalledTimes(1);
    expect(startGeneration).toHaveBeenCalledWith({
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 4,
      generationRequestId: 'request-stable-1',
      sharedConfig,
      generation,
    });
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(state)).not.toContain('secret-must-stay-transient');
  });

  it('matrix 外 generation 字段在离开 bridge 前 fail closed', async () => {
    const state = stateFor('host');
    const startGeneration = vi.fn(async () => {});
    const controller = {
      getSnapshot: () => state,
      startGeneration,
    } as unknown as ArenaRoomController;

    await expect(dispatchArenaRoomGenerationStart({
      controller,
      state,
      sharedConfig,
      generationRequestId: 'request-unclassified-1',
      generation: {
        generationRequestId: 'request-unclassified-1',
        unclassifiedSemantic: { shadowAuthority: true },
      },
    })).rejects.toThrow('ARENA_GENERATION_FIELD_UNCLASSIFIED:unclassifiedSemantic');
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it('starting/unavailable 只开放显式 retry，不把它误当成新 start', async () => {
    const base = stateFor('host', 'unavailable');
    const mirror = {
      generationRequestId: 'request-stable-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'starting' as const,
      configRevision: 4,
      snapshotDigest: `sha256:${'a'.repeat(64)}`,
      collaborativeInfluence: false,
      participantUserIds: [101],
      startedAt: '2026-08-28T00:00:00.000Z',
    };
    const state: ArenaRoomControllerState = {
      ...base,
      session: {
        ...base.session!,
        snapshot: { ...base.session!.snapshot, activeGeneration: mirror },
      },
      generation: {
        ...base.generation,
        mirror,
        pendingRequestId: mirror.generationRequestId,
      },
    };
    expect(resolveArenaRoomGenerationAction(state)).toMatchObject({
      canStart: false,
      canRetry: true,
      reason: 'recovery',
    });
    const retryGenerationStart = vi.fn(async () => {});
    const controller = {
      getSnapshot: () => state,
      retryGenerationStart,
    } as unknown as ArenaRoomController;
    await expect(dispatchArenaRoomGenerationRetry({ controller, state }))
      .resolves.toBe('submitted');
    expect(retryGenerationStart).toHaveBeenCalledOnce();

    expect(resolveArenaRoomGenerationAction({
      ...state,
      generation: { ...state.generation, pendingRequestId: null },
    })).toMatchObject({
      canStart: false,
      canRetry: false,
      reason: 'unknown',
    });
  });

  it('构造共享配置期间 epoch/revision 改变时拒绝提交旧请求', async () => {
    const captured = stateFor('host');
    const current = {
      ...captured,
      session: {
        ...captured.session!,
        roomEpoch: 'epoch-2',
        snapshot: {
          ...captured.session!.snapshot,
          roomEpoch: 'epoch-2',
          revision: 0,
        },
      },
    };
    const startGeneration = vi.fn(async () => {});
    const controller = {
      getSnapshot: () => current,
      startGeneration,
    } as unknown as ArenaRoomController;

    await expect(dispatchArenaRoomGenerationStart({
      controller,
      state: captured,
      sharedConfig,
      generationRequestId: 'request-stale-1',
      generation: { generationRequestId: 'request-stale-1' },
    })).resolves.toBe('stale');
    expect(startGeneration).not.toHaveBeenCalled();
  });
});
