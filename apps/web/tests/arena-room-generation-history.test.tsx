// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArenaRoomGenerationHistory } from '@/components/arena/multiplayer/ArenaRoomGenerationHistory';
import type { ArenaRoomGenerationHistoryReader } from '@/components/arena/multiplayer/useArenaRoom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/arena/components/BattleResultPresentation', () => ({
  BattleResultPresentation: ({ report }: { report: { content: string } }) => (
    <article data-testid="history-report">{report.content}</article>
  ),
}));

const history = {
  protocolVersion: 1 as const,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  items: [{
    generationId: 'generation-1',
    state: 'completed' as const,
    configRevision: 3,
    collaborativeInfluence: true,
    startedAt: '2026-09-02T00:00:00.000Z',
    finishedAt: '2026-09-02T00:03:00.000Z',
  }],
};

const view = {
  protocolVersion: 1 as const,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  generation: {
    generationId: 'generation-1',
    state: 'completed' as const,
    configRevision: 3,
    collaborativeInfluence: true,
    startedAt: '2026-09-02T00:00:00.000Z',
    finishedAt: '2026-09-02T00:03:00.000Z',
  },
  status: 'completed' as const,
  contentStatus: 'available' as const,
  markdown: '# 先前的权威战报',
  result: {
    version: 1 as const,
    format: 'stream-markdown' as const,
    mode: 'classic' as const,
  },
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

describe('Arena Room generation history', () => {
  it('打开后加载有界列表并按需读取权威历史详情', async () => {
    const reader: ArenaRoomGenerationHistoryReader = {
      list: vi.fn(async () => history),
      read: vi.fn(async () => view),
    };
    await act(async () => root.render(<ArenaRoomGenerationHistory reader={reader} />));
    await act(async () => { await Promise.resolve(); });

    expect(reader.list).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('已完成 · 配置版本 3 · 包含协作变更');
    const viewButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === '查看战报');
    if (!(viewButton instanceof HTMLButtonElement)) throw new Error('history view button missing');
    await act(async () => {
      viewButton.click();
      await Promise.resolve();
    });

    expect(reader.read).toHaveBeenCalledWith('generation-1');
    expect(container.querySelector('[data-testid="history-report"]')?.textContent)
      .toBe('# 先前的权威战报');
    expect(container.textContent).toContain('权威历史战报');
  });

  it('读取失败时显示明确错误而不伪造空历史', async () => {
    const reader: ArenaRoomGenerationHistoryReader = {
      list: vi.fn(async () => { throw new Error('房间会话已变化'); }),
      read: vi.fn(async () => view),
    };
    await act(async () => root.render(<ArenaRoomGenerationHistory reader={reader} />));
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('房间会话已变化');
  });

  it('读取另一条失败时清除先前正文，正文过期按非重试终态提示', async () => {
    const secondHistory = {
      ...history,
      items: [
        ...history.items,
        { ...history.items[0], generationId: 'generation-2', configRevision: 4 },
      ],
    };
    const reader: ArenaRoomGenerationHistoryReader = {
      list: vi.fn(async () => secondHistory),
      read: vi.fn(async (generationId) => {
        if (generationId === 'generation-2') throw new Error('正文读取失败');
        return view;
      }),
    };
    await act(async () => root.render(<ArenaRoomGenerationHistory reader={reader} />));
    await act(async () => { await Promise.resolve(); });
    const viewButtons = [...container.querySelectorAll('button')]
      .filter((candidate) => candidate.textContent?.trim() === '查看战报');
    await act(async () => {
      viewButtons[0]?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="history-report"]')).not.toBeNull();
    await act(async () => {
      viewButtons[1]?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="history-report"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('正文读取失败');

    vi.mocked(reader.read).mockResolvedValueOnce({
      ...view,
      contentStatus: 'expired',
      markdown: '',
      result: undefined,
    });
    await act(async () => {
      viewButtons[1]?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('战报正文已超过有限保留期');
  });
});
