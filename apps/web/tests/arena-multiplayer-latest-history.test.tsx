// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArenaRoomLatestHistoryResult } from '@/components/arena/multiplayer/ArenaRoomLatestHistoryResult';
import { useArenaRoomLatestCompletedHistory } from '@/components/arena/multiplayer/useArenaRoomLatestCompletedHistory';
import type { ArenaRoomGenerationHistoryReader } from '@/components/arena/multiplayer/useArenaRoom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/arena/components/BattleResultPresentation', () => ({
  BattleResultPresentation: ({ report }: { report: { content: string } }) => (
    <article data-testid="latest-report">{report.content}</article>
  ),
}));

const completedItem = {
  generationId: 'generation-9',
  state: 'completed' as const,
  configRevision: 5,
  collaborativeInfluence: true,
  startedAt: '2026-09-01T08:00:00.000Z',
  finishedAt: '2026-09-01T08:03:00.000Z',
};

const historyResponse = {
  protocolVersion: 1 as const,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  items: [completedItem],
};

const availableView = {
  protocolVersion: 1 as const,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  generation: completedItem,
  status: 'completed' as const,
  contentStatus: 'available' as const,
  markdown: '# 加入前的权威战报',
  result: {
    version: 1 as const,
    format: 'stream-markdown' as const,
    mode: 'classic' as const,
  },
};

type HookHarness = {
  readonly states: Array<{
    readonly status: string;
    readonly completedCount: number;
    readonly hasLatest: boolean;
  }>;
  setSessionKey(sessionKey: string | null): void;
  setEnabled(enabled: boolean): void;
};

const renderHook = (
  reader: ArenaRoomGenerationHistoryReader,
  initial: { readonly sessionKey: string | null; readonly enabled: boolean },
): HookHarness => {
  const harness: {
    states: Array<{ status: string; completedCount: number; hasLatest: boolean }>;
    sessionKey: string | null;
    enabled: boolean;
  } = {
    states: [],
    sessionKey: initial.sessionKey,
    enabled: initial.enabled,
  };
  const Probe = (): null => {
    const state = useArenaRoomLatestCompletedHistory({
      reader,
      sessionKey: harness.sessionKey,
      enabled: harness.enabled,
    });
    harness.states.push({
      status: state.status,
      completedCount: state.completedCount,
      hasLatest: state.latest !== null,
    });
    return null;
  };
  act(() => {
    root.render(<Probe />);
  });
  return {
    states: harness.states,
    setSessionKey(sessionKey: string | null) {
      harness.sessionKey = sessionKey;
      harness.states.splice(0, harness.states.length);
      act(() => root.render(<Probe />));
    },
    setEnabled(enabled: boolean) {
      harness.enabled = enabled;
      harness.states.splice(0, harness.states.length);
      act(() => root.render(<Probe />));
    },
  };
};

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('useArenaRoomLatestCompletedHistory', () => {
  it('加入空闲房间后读取最近一场 completed 战报并暴露有界计数', async () => {
    const reader: ArenaRoomGenerationHistoryReader = {
      list: vi.fn(async () => historyResponse),
      read: vi.fn(async () => availableView),
    };
    const harness = renderHook(reader, { sessionKey: 'room-1\nepoch-1\nuser-1', enabled: true });
    await settle();

    expect(reader.list).toHaveBeenCalledOnce();
    expect(reader.read).toHaveBeenCalledWith('generation-9');
    expect(harness.states.at(-1)).toEqual({ status: 'ready', completedCount: 1, hasLatest: true });
  });

  it('房间还没有战报时 ready 且 latest 为空，不发起正文读取', async () => {
    const reader: ArenaRoomGenerationHistoryReader = {
      list: vi.fn(async () => ({ ...historyResponse, items: [] })),
      read: vi.fn(async () => availableView),
    };
    const harness = renderHook(reader, { sessionKey: 'room-1\nepoch-1\nuser-1', enabled: true });
    await settle();

    expect(reader.read).not.toHaveBeenCalled();
    expect(harness.states.at(-1)).toEqual({ status: 'ready', completedCount: 0, hasLatest: false });
  });

  it('历史读取失败只标记 failed，不重试也不抛出', async () => {
    const reader: ArenaRoomGenerationHistoryReader = {
      list: vi.fn(async () => { throw new Error('历史战报属于其他房间实例'); }),
      read: vi.fn(async () => availableView),
    };
    const harness = renderHook(reader, { sessionKey: 'room-1\nepoch-1\nuser-1', enabled: true });
    await settle();

    expect(harness.states.at(-1)).toEqual({ status: 'failed', completedCount: 0, hasLatest: false });
    expect(reader.list).toHaveBeenCalledOnce();
  });

  it('同一会话内在 enabled 翻转时保留已加载结果；离开后加入新房才重读', async () => {
    const reader: ArenaRoomGenerationHistoryReader = {
      list: vi.fn(async () => historyResponse),
      read: vi.fn(async () => availableView),
    };
    const harness = renderHook(reader, { sessionKey: 'room-1\nepoch-1\nuser-1', enabled: true });
    await settle();
    expect(harness.states.at(-1)).toEqual({ status: 'ready', completedCount: 1, hasLatest: true });

    harness.setEnabled(false);
    await settle();
    expect(reader.list).toHaveBeenCalledOnce();
    expect(harness.states.at(-1)).toEqual({ status: 'ready', completedCount: 1, hasLatest: true });

    harness.setEnabled(true);
    await settle();
    expect(reader.list).toHaveBeenCalledOnce();

    harness.setSessionKey(null);
    harness.setEnabled(true);
    harness.setSessionKey('room-2\nepoch-2\nuser-1');
    await settle();
    expect(reader.list).toHaveBeenCalledTimes(2);
    expect(harness.states.at(-1)).toEqual({ status: 'ready', completedCount: 1, hasLatest: true });
  });

  it('离开房间后立即清空历史状态', async () => {
    const reader: ArenaRoomGenerationHistoryReader = {
      list: vi.fn(async () => historyResponse),
      read: vi.fn(async () => availableView),
    };
    const harness = renderHook(reader, { sessionKey: 'room-1\nepoch-1\nuser-1', enabled: true });
    await settle();

    harness.setSessionKey(null);
    await settle();
    expect(harness.states.at(-1)).toEqual({ status: 'idle', completedCount: 0, hasLatest: false });
  });
});

describe('ArenaRoomLatestHistoryResult', () => {
  const baseHistory = {
    status: 'ready' as const,
    completedCount: 1,
    latest: availableView,
  };

  it('可读历史按非流式呈现并明确标注为历史战报', () => {
    const html = renderToStaticMarkup(
      <ArenaRoomLatestHistoryResult history={baseHistory} />,
    );
    expect(html).toContain('最近一场房间战报');
    expect(html).toContain('历史战报');
    expect(html).toContain('包含协作变更');
    expect(html).toContain('配置版本 5');
  });

  it('正文过期与未归档给出可理解终态而不伪装战报', () => {
    const expired = renderToStaticMarkup(
      <ArenaRoomLatestHistoryResult history={{ ...baseHistory, latest: { ...availableView, contentStatus: 'expired', markdown: '', result: undefined } }} />,
    );
    expect(expired).toContain('战报正文已超过有限保留期');

    const notArchived = renderToStaticMarkup(
      <ArenaRoomLatestHistoryResult history={{ ...baseHistory, latest: { ...availableView, contentStatus: 'not-archived', markdown: '', result: undefined } }} />,
    );
    expect(notArchived).toContain('未成功归档');
  });

  it('失败时显示降级提示，加载中与无历史不渲染', () => {
    const failed = renderToStaticMarkup(
      <ArenaRoomLatestHistoryResult history={{ status: 'failed', completedCount: 0, latest: null }} />,
    );
    expect(failed).toContain('暂时无法读取');

    expect(renderToStaticMarkup(
      <ArenaRoomLatestHistoryResult history={{ status: 'loading', completedCount: 0, latest: null }} />,
    )).toBe('');
    expect(renderToStaticMarkup(
      <ArenaRoomLatestHistoryResult history={{ status: 'ready', completedCount: 0, latest: null }} />,
    )).toBe('');
  });
});
