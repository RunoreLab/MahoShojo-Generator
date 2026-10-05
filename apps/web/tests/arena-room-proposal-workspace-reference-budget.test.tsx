// @vitest-environment jsdom

/**
 * 「参考项联合预算用尽」这条门禁**必须**单独成文件，不能并回
 * `arena-room-proposal-workspace.test.tsx`。
 *
 * 起因是一次把「慢」归错因的排查。此处渲染 `MAX_ARENA_REFERENCE_ITEMS`（256）个参考项，
 * 曾经是全套件最慢的一条，于是当时的结论是「并发超订造成放大」，并据此把
 * `apps/web` 套件级超时从 15s 抬到 60s、给本条单独加 120s 行内预算。
 *
 * 重新实测后，那次归因是错的。同一个测试体，只因为在文件里的位置不同就差 17 倍：
 *
 * | 运行方式 | 本条耗时 |
 * | --- | --- |
 * | `-t` 只跑本条 | 357ms |
 * | 放在文件首位 | 2,460ms |
 * | 放在文件末位（前有 10 次 workspace 全量渲染） | 6,107ms |
 * | 428 文件全量、worker=15 | 约 49,000ms |
 *
 * 本机 16 逻辑核，把 worker 数压到 3（CI 的真实值）后本条仍需 10.3s——而 3 个 worker 在 16 核上
 * 根本不存在 CPU 争抢。所以成本既不来自并发，也不来自这条用例自己的工作量，而来自**同一个
 * jsdom 环境里逐条累积的堆**：它渲染的节点最多，于是最先撞上主 GC 的代价，位置越靠后越贵。
 *
 * 「worker 越少越快」是真的，但那是附带效应，不是根因。把它当根因就会一路加超时，而加超时
 * 既没治病，又让门禁失去敏感度。
 *
 * 拆成独立文件后它拿到全新的 jsdom 环境与空堆，等同于「只跑本条」的 357ms 量级；实测拆分后
 * 本条 0.35s、原文件从 7.18s 降到 1.00s，全套件最慢用例从 49s 降到 6.8s。
 * 断言一条没动，256 项一项没减——**减项会让这条用例不再测它声称要测的 256 上限契约**。
 *
 * 真正要盯的是这个累积效应本身：如果哪天别的用例也长到秒级，先查同文件内更早的渲染，
 * 而不是先加超时。
 */

import React, { act } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import { createRoomProposalArenaEditorSession } from '@/components/arena/editor';
import { ArenaRoomProposalWorkspaceView } from '@/components/arena/multiplayer/ArenaRoomProposalWorkspace';
import { MAX_ARENA_REFERENCE_ITEMS } from '@/lib/arena/resource-budget';
import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';
import {
  buildArenaRoomState,
  closeArenaWorkspaceDom,
  createArenaWorkspaceQueries,
  openArenaWorkspaceDom,
} from './helpers/arena-room-proposal-workspace';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/config', () => ({
  config: { ENABLE_ARENA_USER_GUIDANCE: true },
}));

vi.mock('@/components/arena/hooks/useArenaData', () => ({
  useLanguagesQuery: () => ({
    data: [
      { code: 'zh-CN', name: '简体中文' },
      { code: 'ja', name: '日本語' },
    ],
  }),
}));

let container: HTMLDivElement;
let root: ReturnType<typeof openArenaWorkspaceDom>['root'];

beforeEach(() => {
  ({ container, root } = openArenaWorkspaceDom());
});

afterEach(async () => {
  await closeArenaWorkspaceDom(container, root);
});

describe('Arena 房间参考项联合预算', () => {
  it('素材与辅助情景入口投影参考项联合预算，预算用尽时禁用', async () => {
    const { button, buttonsWithText, buttonContaining } = createArenaWorkspaceQueries();
    const auxScenarios = Array.from({ length: MAX_ARENA_REFERENCE_ITEMS }, (_, index) => ({
      key: `data-card:scenario-aux-${index}`,
      ref: {
        id: `scenario-aux-${index}`,
        kind: 'scenario' as const,
        versionToken: `version-aux-${index}`,
      },
    }));
    const exhaustedConfig: ArenaRoomSharedConfig = {
      ...buildArenaRoomState().session!.snapshot.sharedConfig,
      battleMode: 'scenario',
      scenario: {
        key: 'data-card:scenario-main',
        ref: { id: 'scenario-main', kind: 'scenario', versionToken: 'version-main' },
      },
      auxScenarios,
    };
    const editor = createRoomProposalArenaEditorSession({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 7,
      sharedConfig: exhaustedConfig,
    });
    const exhaustedState: ArenaRoomControllerState = buildArenaRoomState(exhaustedConfig);
    const controller = {
      submitProposal: vi.fn(async () => undefined),
      withdrawProposal: vi.fn(async () => undefined),
      reconnect: vi.fn(),
    } satisfies Pick<ArenaRoomController, 'reconnect' | 'submitProposal' | 'withdrawProposal'>;

    await act(async () => root.render(
      <ArenaRoomProposalWorkspaceView editor={editor} state={exhaustedState} controller={controller} />,
    ));

    expect(container.textContent).toContain('已选素材 0；参考项合计 256/256');
    expect(button('浏览在线数据卡').disabled).toBe(true);

    await act(async () => buttonContaining('辅助情景（可选）').click());
    expect(container.textContent).not.toContain('（请先选择主情景）');
    expect(container.textContent).toContain('（参考项总预算已用尽）');
    expect(container.textContent).toContain('参考项合计 256/256');
    const auxBrowseButtons = buttonsWithText('浏览在线情景库');
    expect(auxBrowseButtons.length).toBe(2);
    expect(auxBrowseButtons[1]!.disabled).toBe(true);
    await act(async () => editor.dispose());
  });
});