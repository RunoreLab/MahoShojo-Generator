// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { useNarrativeHistoryStore } from '@/components/arena/stores/useNarrativeHistoryStore';
import { useNarrativeDraftsStore } from '@/components/arena/stores/useNarrativeDraftsStore';
import type { BattleStoreState } from '@/components/arena/types';
import type { ArenaGenerationConnectionState } from '@/lib/arena/resumable-generation-client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  handleGenerate: vi.fn(async () => {}),
  stopGeneration: vi.fn(),
  confirmGenerateAfterUnconfirmedCancel: vi.fn(),
  isCooldown: false,
  isGenerating: false,
  arenaGenerationConnectionState: null as ArenaGenerationConnectionState | null,
  isRecoveringArenaGeneration: false,
  arenaGenerationStatusNotice: null as string | null,
  resolvePreflight: vi.fn(),
  preflight: null as null | {
    reasons: readonly ('baseline-missing' | 'host-local-content' | 'shared-config' | 'working-copy-invalid')[];
    canPublish: boolean;
    canConfirmStart: boolean;
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
    confirmGenerateAfterUnconfirmedCancel: mocks.confirmGenerateAfterUnconfirmedCancel,
    isGenerating: mocks.isGenerating,
    arenaGenerationConnectionState: mocks.arenaGenerationConnectionState,
    isRecoveringArenaGeneration: mocks.isRecoveringArenaGeneration,
    arenaGenerationStatusNotice: mocks.arenaGenerationStatusNotice,
    isCooldown: mocks.isCooldown,
    remainingTime: mocks.isCooldown ? 30 : 0,
    providerCooldownMode: 'system',
    otherRemainingTime: 0,
    streamSoftTimeoutWarning: null,
    arenaRoomGenerationPreflight: mocks.preflight,
    resolveArenaRoomGenerationPreflight: mocks.resolvePreflight,
  }),
}));

let battleState: BattleStoreState;

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
  StreamStopButton: (props: { onClick: () => void; label?: string; disabled?: boolean }) => (
    <button type="button" onClick={props.onClick} aria-label={props.label} disabled={props.disabled}>
      {props.label ?? '停止生成'}
    </button>
  ),
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
  localStorage.clear();
  const initial = useBattleStore.getInitialState();
  useBattleStore.setState({ ...initial, battleMode: 'classic', generationMode: 'stream', combatants: ['甲', '乙'].map(name => ({
    type: 'general-character', filename: `${name}.json`, data: { name }, isValid: true, isPreset: false,
  })) });
  useNarrativeHistoryStore.setState(useNarrativeHistoryStore.getInitialState());
  useNarrativeDraftsStore.setState(useNarrativeDraftsStore.getInitialState());
  battleState = useBattleStore.getState();
  mocks.handleGenerate.mockClear();
  mocks.stopGeneration.mockClear();
  mocks.confirmGenerateAfterUnconfirmedCancel.mockClear();
  mocks.isCooldown = false;
  mocks.isGenerating = false;
  mocks.arenaGenerationConnectionState = null;
  mocks.isRecoveringArenaGeneration = false;
  mocks.arenaGenerationStatusNotice = null;
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

  it('恢复上一场战报时明确展示恢复状态与放弃恢复动作', async () => {
    mocks.isGenerating = true;
    mocks.arenaGenerationConnectionState = 'resuming';
    mocks.isRecoveringArenaGeneration = true;
    mocks.arenaGenerationStatusNotice = '正在恢复上一场战报生成。';

    const button = await render();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('正在恢复上一场战报');

    const stopButton = document.body.querySelector<HTMLButtonElement>('[aria-label="放弃恢复"]');
    expect(stopButton).not.toBeNull();
    expect(document.body.querySelector('[data-arena-generation-status="true"]')?.textContent)
      .toContain('上一场战报可能仍在服务器生成');

    await act(async () => stopButton?.click());
    expect(mocks.stopGeneration).toHaveBeenCalledOnce();
  });

  it('本地结束后继续显示服务器确认状态，禁用新生成且移除停止按钮', async () => {
    mocks.isGenerating = false;
    mocks.arenaGenerationConnectionState = 'cancelling';
    mocks.arenaGenerationStatusNotice = '已停止本地接收，正在请求服务器停止生成。';

    const button = await render();
    expect(button.textContent).toContain('正在确认服务器');
    expect(button.disabled).toBe(true);
    expect(document.body.querySelector('[data-arena-generation-status]')?.textContent).toContain('已停止本地接收');

    const stopButton = document.body.querySelector<HTMLButtonElement>('[aria-label="正在停止…"]');
    expect(stopButton).toBeNull();
  });

  it.each([false, true])('取消未确认时显式提示重复费用风险并遵守冷却（冷却=%s）', async (cooldown) => {
    mocks.arenaGenerationConnectionState = 'cancel_unconfirmed';
    mocks.arenaGenerationStatusNotice = '生成可能仍在后台继续。';
    mocks.isCooldown = cooldown;
    const button = await render();
    expect(button.disabled).toBe(true);
    const notice = document.body.querySelector('[data-arena-generation-status]')!;
    expect(notice.textContent).toContain('可能仍在运行并产生费用');
    const riskButton = notice.querySelector('button')!;
    expect(riskButton.disabled).toBe(cooldown);
    await act(async () => riskButton.click());
    expect(mocks.confirmGenerateAfterUnconfirmedCancel).toHaveBeenCalledTimes(cooldown ? 0 : 1);
    if (cooldown) expect(notice.textContent).toContain('还需 30 秒');
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

  it('dirty preflight 只暴露显式发布、同步房间配置与取消三个决策', async () => {
    mocks.roomState = stateFor('host');
    mocks.preflight = {
      reasons: ['shared-config', 'host-local-content'],
      canPublish: true,
      canConfirmStart: false,
      pendingProposalCount: 0,
      busy: false,
    };
    await render();

    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'));
    const publish = buttons.find((button) => button.textContent?.includes('更新房间并开始'));
    const syncRoom = buttons.find((button) => button.textContent?.includes('使用房间设置'));
    const cancel = buttons.find((button) => button.textContent?.trim() === '取消');
    expect(publish).toBeTruthy();
    expect(syncRoom).toBeTruthy();
    expect(cancel).toBeTruthy();
    expect(buttons.find((button) => button.textContent?.includes('按当前房间配置开始'))).toBeUndefined();

    await act(async () => syncRoom!.click());
    expect(mocks.resolvePreflight).toHaveBeenCalledWith('sync-room');
  });

  it('干净配置 + 待处理提案的 preflight 只提供确认开始与取消', async () => {
    mocks.roomState = stateFor('host');
    mocks.preflight = {
      reasons: [],
      canPublish: false,
      canConfirmStart: true,
      pendingProposalCount: 2,
      busy: false,
    };
    await render();

    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'));
    const confirmStart = buttons.find((button) => button.textContent?.includes('确认按当前配置开始'));
    const cancel = buttons.find((button) => button.textContent?.trim() === '取消');
    expect(confirmStart).toBeTruthy();
    expect(cancel).toBeTruthy();
    expect(buttons.find((button) => button.textContent?.includes('更新房间并开始'))).toBeUndefined();

    await act(async () => confirmStart!.click());
    expect(mocks.resolvePreflight).toHaveBeenCalledWith('confirm-start');
  });
});
