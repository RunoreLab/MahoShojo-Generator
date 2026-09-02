import { describe, expect, it } from 'vitest';

import {
  canAutoPublishArenaRoomHostDraft,
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
});
