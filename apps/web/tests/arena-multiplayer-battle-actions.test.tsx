// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import type { UserAIProviderConfig } from '@/lib/ai/custom-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  handleGenerate: vi.fn(async () => {}),
  stopGeneration: vi.fn(),
  resolvePreflight: vi.fn(),
  preflight: null as null | {
    reasons: readonly ('baseline-missing' | 'host-local-content' | 'shared-config' | 'working-copy-invalid')[];
    canUseRoom: boolean;
    canPublish: boolean;
    pendingProposalCount: number;
    busy: boolean;
  },
  roomState: null as ArenaRoomControllerState | null,
  tokenIndicatorProps: null as Record<string, unknown> | null,
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
    arenaRoomGenerationPreflight: mocks.preflight,
    resolveArenaRoomGenerationPreflight: mocks.resolvePreflight,
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
  userProviderConfig: null as UserAIProviderConfig | null,
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
vi.mock('@/components/shared/TokenIndicator', () => ({
  TokenIndicator: (props: Record<string, unknown>) => {
    mocks.tokenIndicatorProps = props;
    return null;
  },
}));
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
  battleState.combatants.splice(0, battleState.combatants.length, { data: { name: '甲' } }, { data: { name: '乙' } });
  mocks.handleGenerate.mockClear();
  mocks.resolvePreflight.mockClear();
  mocks.preflight = null;
  mocks.roomState = null;
  mocks.tokenIndicatorProps = null;
  battleState.userProviderConfig = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async (showAdvancedUtilities = false) => {
  await act(async () => root.render(<BattleActions showAdvancedUtilities={showAdvancedUtilities} />));
  return container.querySelector<HTMLButtonElement>('.generate-button')!;
};

describe('Arena context budget indicator', () => {
  it('uses the 128k hosted-system application budget', async () => {
    await render(true);

    expect(mocks.tokenIndicatorProps).toMatchObject({
      maxTokens: 128_000,
      warnTokens: 102_400,
      budgetLabel: '当前默认渠道应用预算',
    });
  });

  it('uses the 1M Hosted BYOK application budget for a valid custom Provider', async () => {
    battleState.userProviderConfig = {
      providerId: 'chatbox',
      modelId: 'gpt-5.4',
      apiKey: 'test-api-key',
    };

    await render(true);

    expect(mocks.tokenIndicatorProps).toMatchObject({
      maxTokens: 1_000_000,
      warnTokens: 800_000,
      budgetLabel: 'Hosted BYOK 应用预算',
    });
  });
});

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

  it('房主空闲时复用现有生成按钮，运行中锁定；unknown 只显示显式同请求重试', async () => {
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
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('确认并重试同一次启动');
  });

  it('房间 host 不被 stale 本地人数门禁阻断，仍可进入 Room authority preflight', async () => {
    mocks.roomState = stateFor('host');
    battleState.combatants.splice(0, battleState.combatants.length);
    const button = await render();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(mocks.handleGenerate).toHaveBeenCalledOnce();
  });

  it('dirty preflight 只暴露显式发布、沿用房间与取消三个决策', async () => {
    mocks.roomState = stateFor('host');
    mocks.preflight = {
      reasons: ['shared-config', 'host-local-content'],
      canUseRoom: true,
      canPublish: true,
      pendingProposalCount: 0,
      busy: false,
    };
    await render();

    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'));
    const publish = buttons.find((button) => button.textContent?.includes('更新房间配置并开始'));
    const useRoom = buttons.find((button) => button.textContent?.includes('按当前房间配置开始'));
    const cancel = buttons.find((button) => button.textContent?.trim() === '取消');
    expect(publish).toBeTruthy();
    expect(useRoom).toBeTruthy();
    expect(cancel).toBeTruthy();

    await act(async () => useRoom!.click());
    expect(mocks.resolvePreflight).toHaveBeenCalledWith('use-room');
  });
});
