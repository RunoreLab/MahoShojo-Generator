import { describe, expect, it } from 'vitest';

import {
  ARENA_ROOM_GENERATION_SYNC_GATE_MESSAGE,
  arenaRoomGenerationSyncGateMessage,
  canAutoPublishArenaRoomHostDraft,
  canPublishArenaRoomGenerationDraft,
  isArenaRoomGenerationFenceCurrent,
  isArenaRoomGenerationSyncSettled,
  pendingProposalFingerprint,
} from '@/components/arena/multiplayer/generation-preflight';
import type { ArenaProposal } from '@mahoshojo/contracts/arena-room';

const proposal = (proposalId: string, updatedAt?: string): ArenaProposal => ({
  proposalVersion: 1,
  proposalId,
  roomId: 'room-1',
  authorUserId: 'member-1',
  baseRevision: 0,
  status: 'submitted',
  changes: [{
    changeId: `change-${proposalId}`,
    type: 'setUserGuidance',
    value: '建议',
    expectedBase: { kind: 'value', value: '' },
  }],
  createdAt: '2026-09-02T00:00:00.000Z',
  ...(updatedAt ? { updatedAt } : {}),
});

describe('Arena Room generation preflight policy', () => {
  it('只在无提案、无冲突且 workspace baseline 精确匹配时允许自动发布', () => {
    expect(canAutoPublishArenaRoomHostDraft({
      pendingProposalCount: 0,
      reconciliationKind: 'synced',
      workspaceAllows: true,
    })).toBe(true);
    expect(canAutoPublishArenaRoomHostDraft({
      pendingProposalCount: 1,
      reconciliationKind: 'synced',
      workspaceAllows: true,
    })).toBe(false);
    expect(canAutoPublishArenaRoomHostDraft({
      pendingProposalCount: 0,
      reconciliationKind: 'conflicted',
      workspaceAllows: true,
    })).toBe(false);
    expect(canAutoPublishArenaRoomHostDraft({
      pendingProposalCount: 0,
      reconciliationKind: 'idle',
      workspaceAllows: false,
    })).toBe(false);
    expect(canAutoPublishArenaRoomHostDraft({
      pendingProposalCount: 0,
      reconciliationKind: 'error',
      workspaceAllows: true,
    })).toBe(false);
  });

  it('提案 fingerprint 与顺序无关，但会感知新增和更新', () => {
    const first = proposal('proposal-1');
    const second = proposal('proposal-2');
    expect(pendingProposalFingerprint([first, second]))
      .toBe(pendingProposalFingerprint([second, first]));
    expect(pendingProposalFingerprint([first]))
      .not.toBe(pendingProposalFingerprint([first, second]));
    expect(pendingProposalFingerprint([first]))
      .not.toBe(pendingProposalFingerprint([
        proposal('proposal-1', '2026-09-02T00:01:00.000Z'),
      ]));
  });

  it('reconciliation synchronizing 与 error 期间禁止任何生成发布方向（回归：空配置覆盖刚接受的提案）', () => {
    for (const kind of ['idle', 'synced', 'conflicted'] as const) {
      expect(isArenaRoomGenerationSyncSettled(kind)).toBe(true);
    }
    // synchronizing：本地即将被房间权威覆盖；
    // error：同步失败后本地与房间权威的关系不确定，发布本地可能覆盖刚接受的提案。
    expect(isArenaRoomGenerationSyncSettled('synchronizing')).toBe(false);
    expect(isArenaRoomGenerationSyncSettled('error')).toBe(false);
    // 手动 dirty preflight 的“更新房间配置并开始”复用同一门禁；
    // error 时文案必须指向重试同步而不是“正在同步”。
    expect(ARENA_ROOM_GENERATION_SYNC_GATE_MESSAGE).toContain('正在同步');
    expect(arenaRoomGenerationSyncGateMessage('synchronizing'))
      .toBe(ARENA_ROOM_GENERATION_SYNC_GATE_MESSAGE);
    expect(arenaRoomGenerationSyncGateMessage('error')).toContain('重试同步');
  });

  it('手动发布方向要求落定基线不落后于当前权威（回归：resolve 安装与 materialize 之间的微窗口）', () => {
    const authority = {
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      ownerUserId: 'host-1',
      revision: 11,
    };
    // 微窗口：reconciliation effect 尚未运行，kind 仍是 stale 'synced'，
    // 但落定基线还停在旧 revision；发布本地草稿会覆盖房主尚未见过的权威变更。
    expect(canPublishArenaRoomGenerationDraft({
      reconciliationKind: 'synced',
      authority,
      settledAuthority: { ...authority, revision: 10 },
    })).toBe(false);
    expect(canPublishArenaRoomGenerationDraft({
      reconciliationKind: 'idle',
      authority,
      settledAuthority: { ...authority, revision: 10 },
    })).toBe(false);
    // 落定基线追上当前权威后恢复可发布。
    expect(canPublishArenaRoomGenerationDraft({
      reconciliationKind: 'synced',
      authority,
      settledAuthority: authority,
    })).toBe(true);
    // 身份变化（房间/纪元/房主）说明基线不属于当前权威，不得发布。
    expect(canPublishArenaRoomGenerationDraft({
      reconciliationKind: 'synced',
      authority,
      settledAuthority: { ...authority, roomEpoch: 'epoch-2' },
    })).toBe(false);
    expect(canPublishArenaRoomGenerationDraft({
      reconciliationKind: 'synced',
      authority,
      settledAuthority: { ...authority, ownerUserId: 'host-2' },
    })).toBe(false);
    // 无落定基线（首发布、页面重载后）保持既有显式发布路径，由 dirty
    // 原因如实呈现给房主决策。
    expect(canPublishArenaRoomGenerationDraft({
      reconciliationKind: 'idle',
      authority,
      settledAuthority: null,
    })).toBe(true);
    // kind 未落定仍然一票否决。
    expect(canPublishArenaRoomGenerationDraft({
      reconciliationKind: 'synchronizing',
      authority,
      settledAuthority: authority,
    })).toBe(false);
    expect(canPublishArenaRoomGenerationDraft({
      reconciliationKind: 'error',
      authority,
      settledAuthority: null,
    })).toBe(false);
  });

  it('最终启动 fence 同时约束房间 authority 与待处理提案集合', () => {
    const expectedAuthority = {
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      ownerUserId: 'host-1',
      revision: 3,
    };
    const proposals = [proposal('proposal-1')];
    const proposalFingerprint = pendingProposalFingerprint(proposals);

    expect(isArenaRoomGenerationFenceCurrent({
      expectedAuthority,
      currentAuthority: expectedAuthority,
      proposals,
      proposalFingerprint,
    })).toBe(true);
    expect(isArenaRoomGenerationFenceCurrent({
      expectedAuthority,
      currentAuthority: { ...expectedAuthority, revision: 4 },
      proposals,
      proposalFingerprint,
    })).toBe(false);
    expect(isArenaRoomGenerationFenceCurrent({
      expectedAuthority,
      currentAuthority: expectedAuthority,
      proposals: [...proposals, proposal('proposal-2')],
      proposalFingerprint,
    })).toBe(false);
  });
});
