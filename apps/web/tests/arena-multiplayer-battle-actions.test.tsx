// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  handleGenerate: vi.fn(async () => {}),
  stopGeneration: vi.fn(),
  roomState: null as ArenaRoomControllerState | null,
}));

vi.mock('@/components/arena/hooks/useBattleEngine', () => ({
  useBattleEngine: () => ({
    handleGenerate: mocks.handleGenerate,
    stopGeneration: mocks.stopGeneration,
    isGenerating: false,
    isCooldown: false,
    remainingTime: 0,
    providerCooldownMode: 'system',
    otherRemainingTime: 0,
    streamSoftTimeoutWarning: null,
  }),
}));

const battleState = {
  combatants: [{ data: { name: '甲' } }, { data: { name: '乙' } }],
  battleMode: 'classic',
  generationMode: 'stream',
  scenario: { content: null },
  auxScenarios: [],
  selectedLanguage: 'zh-CN',
  storyLength: 'default',
  settings: {
    userGuidance: '',
    readArenaHistory: false,
    readArenaHistoryLimit: 3,
    isArenaHistoryUnlimited: false,
    readCurrentState: false,
    readNarrativeHistory: false,
    readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false,
  },
  teams: [],
};

vi.mock('@/components/arena/stores/useBattleStore', () => ({
  useBattleStore: (selector: (state: typeof battleState) => unknown) => selector(battleState),
}));

vi.mock('@/components/arena/stores/useNarrativeHistoryStore', () => ({
  useNarrativeHistoryStore: (selector: (state: { entries: unknown[]; lastUpdatedAt: null }) => unknown) => (
    selector({ entries: [], lastUpdatedAt: null })
  ),
}));

vi.mock('@/components/arena/multiplayer/useArenaRoom', () => ({
  useArenaRoomContext: () => (
    mocks.roomState ? { state: mocks.roomState, controller: {} } : null
  ),
}));

vi.mock('@/components/ai/ProviderCooldownNotice', () => ({
  ProviderCooldownNotice: () => null,
}));
vi.mock('@/components/shared/TokenIndicator', () => ({ TokenIndicator: () => null }));
vi.mock('@/components/shared/CollapsibleSection', () => ({
  CollapsibleSection: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/shared/StreamStopButton', () => ({
  StreamStopButton: () => <button type="button">停止生成</button>,
}));
vi.mock('@/components/arena/components/NarrativeHistoryModal', () => ({
  NarrativeHistoryModal: () => null,
}));

import { BattleActions } from '@/components/arena/components/BattleActions';

const stateFor = (
  role: 'host' | 'member',
  phase: ArenaRoomControllerState['generation']['phase'] = 'idle',
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
      displayName: role,
      membershipState: 'active',
    },
    snapshot: {
      protocolVersion: 1,
      schemaVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 0,
      controlSeq: 0,
      sharedConfig: {} as never,
      members: [],
      proposals: [],
      activeGeneration: null,
    },
  },
  generation: {
    mirror: null,
    phase,
    status: null,
    authoritativeMarkdown: '',
    markdown: '',
    storyCursor: null,
    gap: null,
    finalAuthoritative: false,
    generationRecordId: null,
    errorCode: null,
    pendingRequestId: phase === 'unknown' ? 'request-unknown-1' : null,
    startResultUnknown: phase === 'unknown',
  },
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.handleGenerate.mockClear();
  mocks.roomState = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async () => {
  await act(async () => root.render(<BattleActions showAdvancedUtilities={false} />));
  return container.querySelector<HTMLButtonElement>('.generate-button')!;
};

describe('Arena multiplayer BattleActions authority gate', () => {
  it('feature-off / 非房间页面继续调用既有单人生成动作', async () => {
    mocks.roomState = null;
    const button = await render();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('生成独家新闻');
    await act(async () => button.click());
    expect(mocks.handleGenerate).toHaveBeenCalledTimes(1);
  });

  it('成员只显示等待房主且按钮不可提交', async () => {
    mocks.roomState = stateFor('member');
    const button = await render();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('等待房主开始生成');
    await act(async () => button.click());
    expect(mocks.handleGenerate).not.toHaveBeenCalled();
  });

  it('房主空闲时复用现有生成按钮，运行中或 unknown 时禁止重复提交', async () => {
    mocks.roomState = stateFor('host');
    let button = await render();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(mocks.handleGenerate).toHaveBeenCalledTimes(1);

    mocks.roomState = stateFor('host', 'running');
    button = await render();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('房间战报生成中');

    mocks.roomState = stateFor('host', 'unknown');
    button = await render();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('正在确认上次启动结果');
  });
});
