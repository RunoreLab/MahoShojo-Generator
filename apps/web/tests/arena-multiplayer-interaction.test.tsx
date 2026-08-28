// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  buildSharedConfig: vi.fn(),
  close: vi.fn(async () => undefined),
  create: vi.fn(async () => undefined),
  discover: vi.fn(async () => undefined),
  join: vi.fn(async () => undefined),
  leave: vi.fn(async () => undefined),
  reconnect: vi.fn(),
  reset: vi.fn(),
  state: null as ArenaRoomControllerState | null,
}));

vi.mock('@/components/arena/multiplayer/useArenaRoom', () => ({
  useArenaRoom: () => ({
    controller: {
      close: mocks.close,
      create: mocks.create,
      discover: mocks.discover,
      join: mocks.join,
      leave: mocks.leave,
      reconnect: mocks.reconnect,
      reset: mocks.reset,
    },
    state: mocks.state,
  }),
}));

vi.mock('@/lib/arena-room/shared-config', () => ({
  buildArenaRoomSharedConfigFromBattleState: mocks.buildSharedConfig,
}));

vi.mock('@/components/arena/stores/useBattleStore', () => ({
  useBattleStore: { getState: vi.fn(() => ({ safe: 'battle-state' })) },
}));

import { ArenaMultiplayerPanel } from '@/components/arena/multiplayer/ArenaMultiplayerPanel';

const readyState: ArenaRoomControllerState = {
  phase: 'ready',
  rooms: [],
  session: null,
  notice: null,
  error: null,
  unknownOperation: null,
};

const sharedConfig = {
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

const props = {
  enabled: true,
  origin: 'http://127.0.0.1:8787',
  authLoading: false,
  isAuthenticated: true,
  displayName: '测试玩家',
};

let container: HTMLDivElement;
let root: Root;

const button = (label: string): HTMLButtonElement => {
  const match = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(async () => {
  mocks.state = readyState;
  mocks.buildSharedConfig.mockResolvedValue(sharedConfig);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ArenaMultiplayerPanel {...props} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Arena multiplayer panel real React interactions', () => {
  it('create 的安全映射窗口使用同步锁，双击只提交一个房间', async () => {
    await act(async () => {
      button('创建多人房间').click();
      button('创建多人房间').click();
    });
    await flush();

    expect(mocks.buildSharedConfig).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('真实输入与点击连接 discover/join controller action', async () => {
    await act(async () => button('发现公开房间').click());
    const input = container.querySelector<HTMLInputElement>('#arena-room-join-code');
    if (!input) throw new Error('join input missing');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'room-visible-1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('加入房间').click());

    expect(mocks.discover).toHaveBeenCalledTimes(1);
    expect(mocks.join).toHaveBeenCalledWith('room-visible-1', '测试玩家');
  });

  it('unauthenticated/disabled 真实挂载不暴露 Room action', async () => {
    mocks.state = { ...readyState, phase: 'unauthenticated' };
    await act(async () => root.render(<ArenaMultiplayerPanel {...props} isAuthenticated={false} />));
    expect(container.textContent).toContain('多人房间需要登录后使用');
    expect(container.querySelectorAll('button')).toHaveLength(0);

    mocks.state = { ...readyState, phase: 'disabled' };
    await act(async () => root.render(<ArenaMultiplayerPanel {...props} enabled={false} />));
    expect(container.innerHTML).toBe('');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.join).not.toHaveBeenCalled();
  });
});
