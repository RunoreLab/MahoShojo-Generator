import { describe, expect, it } from 'vitest';

import {
  ARENA_ROOM_GENERATION_SYNC_GATE_MESSAGE,
  canAutoPublishArenaRoomHostDraft,
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

  it('reconciliation synchronizing 期间禁止任何生成发布方向（回归：空配置覆盖刚接受的提案）', () => {
    for (const kind of ['idle', 'synced', 'conflicted', 'error'] as const) {
      expect(isArenaRoomGenerationSyncSettled(kind)).toBe(true);
    }
    expect(isArenaRoomGenerationSyncSettled('synchronizing')).toBe(false);
    // 手动 dirty preflight 的“更新房间配置并开始”也必须复用同一门禁文案。
    expect(ARENA_ROOM_GENERATION_SYNC_GATE_MESSAGE).toContain('正在同步');
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
