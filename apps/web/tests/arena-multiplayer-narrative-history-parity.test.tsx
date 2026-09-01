// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import {
  materializeArenaNarrativeHistoryForRequest,
  selectArenaRoomNarrativeHistoryResultWrite,
} from '@/lib/arena-room/narrative-history-runtime';
import { useArenaRoomNarrativeHistoryResultWriter } from '@/components/arena/multiplayer/useArenaRoomNarrativeHistoryResultWriter';

const entries = Array.from({ length: 3 }, (_, index) => ({
  id: `history-${index + 1}`,
  title: `战报 ${index + 1}`,
  content: `正文 ${index + 1}`,
  createdAt: `2026-08-2${index + 1}T00:00:00.000Z`,
  updatedAt: `2026-08-2${index + 1}T00:00:00.000Z`,
}));
const requestEntries = entries.map(({ title, content, createdAt, updatedAt }) => ({
  title,
  content,
  createdAt,
  updatedAt,
}));

const historySettings = {
  readArenaHistory: true,
  readArenaHistoryLimit: 3,
  isArenaHistoryUnlimited: false,
  writeArenaHistory: true,
  readCurrentState: true,
  writeCurrentState: true,
  readNarrativeHistory: true,
  readNarrativeHistoryLimit: 2,
  isNarrativeHistoryUnlimited: false,
  writeNarrativeHistory: true,
};

const roomState = (
  role: 'host' | 'member',
  writeNarrativeHistory = true,
): ArenaRoomControllerState => ({
  phase: 'connected',
  rooms: [],
  notice: null,
  error: null,
  unknownOperation: null,
  proposalOperation: null,
  proposalResultUnknown: false,
  configPublishPending: false,
  configPublishResultUnknown: false,
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
      revision: 1,
      controlSeq: 3,
      sharedConfig: {
        battleMode: 'daily',
        combatants: [{
          key: 'data-card:character-1',
          ref: { id: 'character-1', kind: 'character', versionToken: 'v1' },
        }],
        teams: [],
        scenario: null,
        auxScenarios: [],
        materials: [],
        userGuidance: '',
        storyLength: 'default',
        customStoryLength: null,
        selectedLanguage: 'zh-CN',
        historySettings: { ...historySettings, writeNarrativeHistory },
      },
      members: [],
      proposals: [],
      activeGeneration: null,
    },
  },
  generation: {
    mirror: {
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'completed',
      configRevision: 1,
      snapshotDigest: 'sha256:generation',
      collaborativeInfluence: false,
      participantUserIds: [],
      startedAt: '2026-08-28T00:00:00.000Z',
    },
    phase: 'completed',
    status: 'completed',
    authoritativeMarkdown: '# 房间战报\n\n权威正文',
    markdown: '# 房间战报\n\n权威正文',
    storyCursor: null,
    gap: null,
    finalAuthoritative: true,
    generationRecordId: 'record-1',
    errorCode: null,
    pendingRequestId: null,
    startResultUnknown: false,
    result: null,
  },
});

describe('GMR10Q-F-NARRATIVE-HISTORY-PARITY', () => {
  it('读取开关与 limit/unlimited 沿用单人的末尾截取语义', () => {
    expect(materializeArenaNarrativeHistoryForRequest(historySettings, entries)).toEqual({
      readLimit: 2,
      entries: [
        expect.objectContaining({ title: '战报 2' }),
        expect.objectContaining({ title: '战报 3' }),
      ],
    });
    expect(materializeArenaNarrativeHistoryForRequest({
      ...historySettings,
      isNarrativeHistoryUnlimited: true,
    }, entries)).toEqual({ readLimit: null, entries: requestEntries });
    expect(materializeArenaNarrativeHistoryForRequest({
      ...historySettings,
      readNarrativeHistory: false,
    }, entries)).toEqual({ readLimit: undefined, entries: undefined });
  });

  it('GMR10Q-F-RESULT-ACTION-PARITY：只有房主在权威终态且开启写入时获得本地叙事历史写权', () => {
    expect(selectArenaRoomNarrativeHistoryResultWrite(roomState('host'))).toEqual({
      title: '房间战报',
      contentMarkdown: '# 房间战报\n\n权威正文',
      generationId: 'generation-1',
    });
    expect(selectArenaRoomNarrativeHistoryResultWrite(roomState('member'))).toBeNull();
    expect(selectArenaRoomNarrativeHistoryResultWrite(roomState('host', false))).toBeNull();
  });

  it('多人请求从房间权威设置 materialize 房主本地正文，不使用 stale 本地设置', async () => {
    const source = await readFile(
      `${process.cwd()}/components/arena/hooks/useBattleEngine.ts`,
      'utf8',
    );
    expect(source).toContain(
      'materializeArenaNarrativeHistoryForRequest(\n          startInputs.sharedConfig.historySettings,',
    );
    expect(source).toContain('narrativeHistory: roomNarrativeHistory.entries,');
  });
});

let container: HTMLDivElement;
let root: Root;

const Harness = ({ state, write }: {
  readonly state: ArenaRoomControllerState;
  readonly write: (payload: {
    title: string;
    contentMarkdown: string;
    generationId?: string | null;
  }) => Promise<void>;
}) => {
  useArenaRoomNarrativeHistoryResultWriter(state, write);
  return null;
};

describe('GMR10Q-F-NARRATIVE-HISTORY-PARITY result writer', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('房主终态只写入一次，成员查看同一结果不获得写入权限', async () => {
    const write = vi.fn(async () => undefined);
    const hostState = roomState('host');
    await act(async () => root.render(<Harness state={hostState} write={write} />));
    await act(async () => root.render(<Harness state={hostState} write={write} />));
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ generationId: 'generation-1' }));

    await act(async () => root.render(<Harness state={roomState('member')} write={write} />));
    expect(write).toHaveBeenCalledOnce();
  });
});
