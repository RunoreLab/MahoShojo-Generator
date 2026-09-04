import { describe, expect, it } from 'vitest';

import {
  createArenaRoomHostWorkspace,
  type ArenaRoomHostWorkspaceAuthority,
} from '@/lib/arena-room/host-workspace';
import type { ArenaRoomHostWorkspaceBundle } from '@/lib/arena-room/shared-config';

const sharedConfig = (guidance = '', contentVersion = `sha256:${'a'.repeat(64)}`) => ({
  battleMode: 'classic' as const,
  combatants: [{
    key: 'host-local:character:0:one',
    displayName: '本地角色',
    type: 'general-character' as const,
    source: 'host-local' as const,
    contentVersion,
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: guidance,
  storyLength: 'standard' as const,
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
});

const bundle = (
  payload: Record<string, unknown> = { name: '本地角色', secret: 'baseline-body' },
  digest = `sha256:${'a'.repeat(64)}`,
  guidance = '',
): ArenaRoomHostWorkspaceBundle => ({
  sharedConfig: sharedConfig(guidance, digest),
  hostLocalPayloads: [{
    key: 'host-local:character:0:one',
    kind: 'character',
    payload,
  }],
  hostLocalContentDigests: [{ key: 'host-local:character:0:one', digest }],
});

const authority = (
  guidance = '',
  overrides: Partial<ArenaRoomHostWorkspaceAuthority> = {},
): ArenaRoomHostWorkspaceAuthority => ({
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  revision: 3,
  ownerUserId: 'host-1',
  sharedConfig: sharedConfig(guidance),
  ...overrides,
});

describe('Arena Room host workspace baseline', () => {
  it('已显式发布的安全配置与本地摘要一致时直接启动', () => {
    const workspace = createArenaRoomHostWorkspace();
    workspace.capturePublished(authority(), bundle());

    const comparison = workspace.compare(authority(), bundle());
    expect(comparison).toMatchObject({ kind: 'clean' });
    if (comparison.kind !== 'clean') throw new Error('expected clean');
    expect(comparison.start.hostLocalPayloads).toEqual(bundle().hostLocalPayloads);
    expect(JSON.stringify(comparison.start.sharedConfig)).not.toContain('baseline-body');
  });

  it('stub 未变但本地正文改变时必须 preflight，按房间启动使用 baseline 正文', () => {
    const workspace = createArenaRoomHostWorkspace();
    workspace.capturePublished(authority(), bundle());
    const changed = bundle(
      { name: '本地角色', secret: 'changed-body' },
      `sha256:${'b'.repeat(64)}`,
    );

    const comparison = workspace.compare(authority(), changed);
    expect(comparison).toMatchObject({
      kind: 'dirty',
      reasons: ['shared-config', 'host-local-content'],
    });
    if (comparison.kind !== 'dirty') throw new Error('expected dirty');
    expect(comparison.current.hostLocalPayloads[0]!.payload).toMatchObject({ secret: 'changed-body' });
  });

  it('Room authority 被 Proposal 改变而 host working copy 未同步时不静默覆盖', () => {
    const workspace = createArenaRoomHostWorkspace();
    workspace.capturePublished(authority(), bundle());

    const comparison = workspace.compare(authority('成员建议已接受'), bundle());
    expect(comparison).toMatchObject({
      kind: 'dirty',
      reasons: ['shared-config'],
      current: { sharedConfig: { userGuidance: '' } },
    });
  });

  it('仅在已捕获 baseline 仍对应同一权威 revision 时允许自动发布', () => {
    const workspace = createArenaRoomHostWorkspace();
    workspace.capturePublished(authority(), bundle());
    const localChange = bundle(
      { name: '本地角色', secret: 'changed-body' },
      `sha256:${'b'.repeat(64)}`,
      '房主本地修改',
    );

    expect(workspace.canAutoPublish(authority(), localChange)).toBe(true);
    expect(workspace.canAutoPublish(authority('', { revision: 4 }), localChange)).toBe(false);
    expect(workspace.canAutoPublish(authority('', { roomEpoch: 'epoch-2' }), localChange)).toBe(false);
  });

  it('缺少当前 room/epoch/owner baseline 时 host-local 按房间启动 fail closed', () => {
    const workspace = createArenaRoomHostWorkspace();
    const comparison = workspace.compare(authority(), bundle());
    expect(comparison).toMatchObject({
      kind: 'dirty',
      reasons: ['baseline-missing'],
    });

    workspace.capturePublished(authority(), bundle());
    workspace.retainFor(authority('', { roomEpoch: 'epoch-2' }));
    expect(workspace.compare(authority('', { roomEpoch: 'epoch-2' }), bundle()))
      .toMatchObject({ kind: 'dirty', reasons: ['baseline-missing'] });
  });

  it('没有 host-local ref 时不需要内存 baseline 也可安全启动', () => {
    const workspace = createArenaRoomHostWorkspace();
    const config = {
      ...sharedConfig(),
      combatants: [{
        key: 'data-card:online-1',
        ref: { id: 'online-1', kind: 'character' as const, versionToken: 'v1' },
      }],
    };
    const onlineBundle: ArenaRoomHostWorkspaceBundle = {
      sharedConfig: config,
      hostLocalPayloads: [],
      hostLocalContentDigests: [],
    };
    const comparison = workspace.compare(authority('', { sharedConfig: config }), onlineBundle);
    expect(comparison).toMatchObject({ kind: 'clean', start: { hostLocalPayloads: [] } });
  });

  it('settledAuthority 跟随最近一次 capture，并在 epoch 变化清空 baseline 时归零', () => {
    const workspace = createArenaRoomHostWorkspace();
    expect(workspace.settledAuthority()).toBeNull();

    workspace.capturePublished(authority(), bundle());
    expect(workspace.settledAuthority()).toMatchObject({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 3,
      ownerUserId: 'host-1',
    });

    workspace.capturePublished(authority('', { revision: 4 }), bundle());
    expect(workspace.settledAuthority()).toMatchObject({ revision: 4 });

    workspace.retainFor(authority('', { roomEpoch: 'epoch-2' }));
    expect(workspace.settledAuthority()).toBeNull();
  });

  it('working copy 无法投影时仍可从已发布 baseline 取得 Room 启动输入', () => {
    const workspace = createArenaRoomHostWorkspace();
    workspace.capturePublished(authority(), bundle());
    expect(workspace.startFromRoom(authority())).toMatchObject({
      sharedConfig: { combatants: [{ contentVersion: `sha256:${'a'.repeat(64)}` }] },
      hostLocalPayloads: [{ payload: { secret: 'baseline-body' } }],
    });
    expect(workspace.startFromRoom(authority('', { roomEpoch: 'epoch-other' }))).toBeNull();
  });
});
