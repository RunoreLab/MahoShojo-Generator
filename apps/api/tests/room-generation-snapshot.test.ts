import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createArenaRoomGenerationSnapshot,
  createArenaRoomGenerationSnapshotFromFrozen,
  listArenaRoomGenerationRefs,
} from '#/arena-room/room-generation-snapshot';
import { createArenaRoomState } from './arena-room-fixtures';

describe('Arena Room frozen generation snapshot', () => {
  it('normalized Markdown retains the digest of old snapshots without reportFormat', () => {
    const snapshot = createArenaRoomGenerationSnapshot(createArenaRoomState(), 'legacy-request');
    const { snapshotDigest, ...frozen } = snapshot;
    const legacyConfig = Object.fromEntries(Object.entries(frozen.sharedConfig)
      .filter(([key]) => key !== 'reportFormat'));
    const canonical = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonical);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]));
    };
    const legacyDigest = `sha256:${createHash('sha256')
      .update(JSON.stringify(canonical({ ...frozen, sharedConfig: legacyConfig }))).digest('hex')}`;
    expect(snapshotDigest).toBe(legacyDigest);
    expect(createArenaRoomGenerationSnapshotFromFrozen(frozen).snapshotDigest).toBe(legacyDigest);
  });

  it('format is frozen into the snapshot digest and later room edits cannot change it', () => {
    const state = createArenaRoomState();
    const markdown = createArenaRoomGenerationSnapshot(state, 'request-format');
    expect(markdown.sharedConfig.reportFormat).toBe('markdown');
    state.snapshot.sharedConfig.reportFormat = 'web';
    const web = createArenaRoomGenerationSnapshot(state, 'request-format');
    expect(web.snapshotDigest).not.toBe(markdown.snapshotDigest);
    expect(web.sharedConfig.reportFormat).toBe('web');
    state.snapshot.sharedConfig.reportFormat = 'markdown';
    expect(web.sharedConfig.reportFormat).toBe('web');
    const { snapshotDigest, ...frozen } = web;
    expect(snapshotDigest).toMatch(/^sha256:/u);
    expect(createArenaRoomGenerationSnapshotFromFrozen(frozen)).toEqual(web);
  });

  it('冻结当前 revision/config/active account participants 与 collaborative provenance', () => {
    const state = createArenaRoomState();
    state.memberAuthority.push({
      accountUserId: 9,
      member: {
        userId: 'member-9',
        role: 'member',
        displayName: '成员',
        membershipState: 'active',
        joinedAt: '2026-08-28T00:00:01.000Z',
      },
    });
    state.snapshot.members.push(structuredClone(state.memberAuthority[1]!.member));
    state.collaborativeChanges.push({
      changeId: 'guidance-1',
      type: 'setUserGuidance',
      value: '协作建议',
      expectedBase: { kind: 'value', value: '' },
    });
    state.snapshot.sharedConfig.userGuidance = '协作建议';

    const snapshot = createArenaRoomGenerationSnapshot(state, 'request-1234');
    expect(snapshot).toMatchObject({
      roomId: state.snapshot.roomId,
      generationRequestId: 'request-1234',
      configRevision: state.snapshot.revision,
      collaborativeInfluence: true,
      participantUserIds: [9, 101],
      sharedConfig: state.snapshot.sharedConfig,
    });
    expect(snapshot.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(createArenaRoomGenerationSnapshotFromFrozen({
      roomId: snapshot.roomId,
      generationRequestId: snapshot.generationRequestId,
      configRevision: snapshot.configRevision,
      collaborativeInfluence: snapshot.collaborativeInfluence,
      participantUserIds: snapshot.participantUserIds,
      sharedConfig: snapshot.sharedConfig,
    })).toEqual(snapshot);

    state.snapshot.sharedConfig.userGuidance = '事后篡改';
    expect(snapshot.sharedConfig.userGuidance).toBe('协作建议');
  });

  it('canonical digest 不受对象 key 顺序影响，但绑定 request/config/participants', () => {
    const state = createArenaRoomState();
    const first = createArenaRoomGenerationSnapshot(state, 'request-1234');
    const reordered = structuredClone(state);
    reordered.snapshot.sharedConfig = Object.fromEntries(
      Object.entries(reordered.snapshot.sharedConfig).reverse(),
    ) as typeof reordered.snapshot.sharedConfig;
    const second = createArenaRoomGenerationSnapshot(reordered, 'request-1234');
    expect(second.snapshotDigest).toBe(first.snapshotDigest);

    expect(createArenaRoomGenerationSnapshot(state, 'request-5678').snapshotDigest)
      .not.toBe(first.snapshotDigest);
    state.snapshot.sharedConfig.userGuidance = 'changed';
    expect(createArenaRoomGenerationSnapshot(state, 'request-1234').snapshotDigest)
      .not.toBe(first.snapshotDigest);
  });

  it('仅提取 canonical data-card refs 并稳定去重，不把 preset/host-local 当 D1 ref', () => {
    const state = createArenaRoomState();
    const config = state.snapshot.sharedConfig;
    config.combatants.push({
      key: 'data-card:character-2',
      ref: { id: 'character-2', kind: 'character', versionToken: 'v2' },
    });
    config.materials.push(
      {
        key: 'data-card:character-2',
        ref: { id: 'character-2', kind: 'material', versionToken: 'v2' },
      },
      {
        key: 'host-local:material:1',
        displayName: '本地材料',
        type: 'material',
        source: 'host-local',
      },
    );

    expect(listArenaRoomGenerationRefs(config)).toEqual([
      { id: 'character-1', kind: 'character', versionToken: 'v1' },
      { id: 'character-2', kind: 'character', versionToken: 'v2' },
      { id: 'character-2', kind: 'material', versionToken: 'v2' },
    ]);
  });
});
