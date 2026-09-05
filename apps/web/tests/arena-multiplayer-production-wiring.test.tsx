// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ArenaMultiplayerContextPanel,
  type ArenaMultiplayerPanelProps,
} from '@/components/arena/multiplayer/ArenaMultiplayerPanel';
import { ArenaEditorWorkspaceBoundary } from '@/components/arena/multiplayer/ArenaRoomProposalWorkspace';
import {
  ArenaRoomProvider,
  useArenaRoomContext,
} from '@/components/arena/multiplayer/useArenaRoom';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { authStorage } from '@/lib/auth';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const host = {
  userId: 'user-host',
  role: 'host' as const,
  displayName: '房主',
  membershipState: 'active' as const,
};

const sessionFor = (role: 'host' | 'member') => {
  const self = role === 'host' ? host : {
    userId: 'user-member',
    role: 'member' as const,
    displayName: '成员',
    membershipState: 'active' as const,
  };
  const snapshot = {
    protocolVersion: 1,
    schemaVersion: 1,
    roomId: 'room-1',
    roomEpoch: 'epoch-1',
    revision: 0,
    controlSeq: 0,
    sharedConfig,
    members: role === 'host' ? [host] : [host, self],
    proposals: [],
    activeGeneration: null,
  };
  return {
    protocolVersion: 1,
    roomId: 'room-1',
    roomEpoch: 'epoch-1',
    self,
    snapshot,
  };
};

class WiringSocket {
  static instances: WiringSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly send = vi.fn();
  readonly close = vi.fn();

  constructor(readonly url: string, readonly protocol: string) {
    WiringSocket.instances.push(this);
  }

  open(): void {
    this.onopen?.();
  }

  message(data: unknown): void {
    this.onmessage?.({ data });
  }

  closed(code: number, reason: string): void {
    this.onclose?.({ code, reason });
  }
}

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const props = {
  enabled: true,
  origin: 'http://127.0.0.1:8787',
  authLoading: false,
  isAuthenticated: true,
  displayName: '测试玩家',
};

const requestPath = (input: string): string => new URL(input, 'http://test.local').pathname;

const PanelUiProbe = () => {
  const runtime = useArenaRoomContext();
  if (!runtime) return null;
  return (
    <>
      <button type="button" onClick={() => runtime.panelUi.setProposalsOpen(true)}>
        probe-open-proposals
      </button>
      <button type="button" onClick={() => runtime.panelUi.setConfigOpen(true)}>
        probe-open-config
      </button>
    </>
  );
};

const productionTree = (panelProps: ArenaMultiplayerPanelProps) => (
  <ArenaRoomProvider
    enabled={panelProps.enabled}
    authenticated={panelProps.isAuthenticated && !panelProps.authLoading}
    origin={panelProps.origin}
  >
    <QueryClientProvider client={queryClient}>
      <ArenaMultiplayerContextPanel {...panelProps} />
      <ArenaEditorWorkspaceBoundary>
        <div data-arena-editor-placeholder="v1" />
      </ArenaEditorWorkspaceBoundary>
    </QueryClientProvider>
  </ArenaRoomProvider>
);

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const button = (label: string): HTMLButtonElement => {
  const match = [...document.body.querySelectorAll('button')]
    .find((candidate) => (
      candidate.textContent?.trim() === label
      || candidate.getAttribute('aria-label')?.split('，')[0] === label
    ));
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
};

const enterJoinCode = async (): Promise<void> => {
  if (!document.body.querySelector('#arena-room-join-code')) {
    await act(async () => button('打开多人房间').click());
    await flush();
  }
  const input = document.body.querySelector<HTMLInputElement>('#arena-room-join-code');
  if (!input) throw new Error('join input missing');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      ?.call(input, 'room-1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const setTextField = async (id: string, value: string): Promise<void> => {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!input) throw new Error(`text field not found: ${id}`);
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      ?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  WiringSocket.instances = [];
  vi.stubGlobal('WebSocket', WiringSocket);
  vi.spyOn(authStorage, 'getAuthHeader').mockResolvedValue('Bearer verified-key');
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Arena multiplayer production client/hook wiring', () => {
  it('disabled/unauthenticated 的真实 hook 不读取 auth、不发 fetch、不建 WSS', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    await act(async () => root.render(
      productionTree({ ...props, enabled: false }),
    ));
    await flush();
    expect(container.querySelector('[data-arena-multiplayer]')).toBeNull();

    await act(async () => root.render(
      productionTree({ ...props, isAuthenticated: false }),
    ));
    await flush();
    expect(container.textContent).toContain('多人房间需要登录后使用');
    expect(fetcher).not.toHaveBeenCalled();
    expect(authStorage.getAuthHeader).not.toHaveBeenCalled();
    expect(WiringSocket.instances).toHaveLength(0);
  });

  it('大厅对话框提供两种玩法提示、玩法说明链接与房间元信息', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/languages.json')) return Response.json([]);
      if (requestPath(url) === '/api/auth/verify') return Response.json({ success: false });
      if (requestPath(url) === '/api/arena/rooms/v1') {
        // 注意：目录页面响应与 RoomDirectoryPageSchema（strict）完全一致，无 protocolVersion。
        return Response.json({
          items: [{
            roomId: 'room-public-1',
            title: '欢迎加入',
            visibility: 'public',
            status: 'open',
            createdAt: '2026-09-04T00:00:00.000Z',
            lastActivityAt: new Date().toISOString(),
            hostDisplayName: 'Alice',
            memberCount: 3,
            memberLimit: 16,
          }],
          nextCursor: null,
        });
      }
      throw new Error(`unexpected Room request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(productionTree(props)));
    await flush();
    await act(async () => button('打开多人房间').click());
    await flush();

    expect(document.body.textContent).toContain('两种最简单的玩法');
    expect(document.body.textContent).toContain('多人跑团');
    // 公开房间目录的丰富元信息（回归：只有标题和 UUID 的调试式列表）
    expect(document.body.textContent).toContain('欢迎加入');
    expect(document.body.textContent).toContain('房主：Alice');
    expect(document.body.textContent).toContain('3/16 人');
    expect(document.body.textContent).toMatch(/前活跃|刚刚活跃/);
    const guideLink = [...document.body.querySelectorAll('a')]
      .find((candidate) => candidate.getAttribute('href') === '/encyclopedia/arena-multiplayer#两种最简单的玩法');
    expect(guideLink).not.toBeUndefined();
  });

  it.each(['host', 'member'] as const)(
    '%s 通过真实 client/hook 完成 join -> ticket -> WSS -> exit epoch fence',
    async (role) => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const session = sessionFor(role);
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith('/languages.json')) return Response.json([]);
        if (requestPath(url) === '/api/auth/verify') return Response.json({ success: false });
        if (requestPath(url) === '/api/arena/rooms/v1') {
          return Response.json({ protocolVersion: 1, items: [], nextCursor: null });
        }
        if (url.endsWith('/join')) return Response.json(session);
        if (url.endsWith('/generations')) {
          return Response.json({ protocolVersion: 1, roomId: 'room-1', roomEpoch: 'epoch-1', items: [] });
        }
        if (url.endsWith('/ticket')) {
          return Response.json({
            protocolVersion: 1,
            ticket: `ticket-${calls.length}`,
            expiresInSeconds: 45,
            websocket: {
              path: '/api/arena/rooms/v1/ws',
              protocol: 'mahoshojo.arena-room.v1',
            },
          });
        }
        if (url.endsWith('/leave') || url.endsWith('/close')) {
          return Response.json({
            protocolVersion: 1,
            roomId: 'room-1',
            outcome: url.endsWith('/close') ? 'closed' : 'left',
          });
        }
        throw new Error(`unexpected Room request: ${url}`);
      });
      vi.stubGlobal('fetch', fetcher);
      await act(async () => root.render(productionTree(props)));
      await enterJoinCode();
      await act(async () => button('加入房间').click());
      await flush();

      expect(WiringSocket.instances).toHaveLength(1);
      expect(WiringSocket.instances[0]).toMatchObject({
        url: 'ws://127.0.0.1:8787/api/arena/rooms/v1/ws?ticket=ticket-3',
        protocol: 'mahoshojo.arena-room.v1',
      });
      await act(async () => WiringSocket.instances[0]!.open());
      const exitLabel = role === 'host' ? '关闭房间' : '离开房间';
      await act(async () => button('更多').click());
      await act(async () => button('房间成员与操作').click());
      await act(async () => button(exitLabel).click());
      await act(async () => button(role === 'host' ? '确认关闭房间' : '确认离开房间').click());
      await flush();

      const roomCalls = calls.filter((call) => requestPath(call.url).startsWith('/api/arena/rooms/v1'));
      expect(roomCalls.map((call) => requestPath(call.url))).toEqual([
        '/api/arena/rooms/v1',
        '/api/arena/rooms/v1/room-1/join',
        '/api/arena/rooms/v1/room-1/ticket',
        '/api/arena/rooms/v1/room-1/generations',
        `/api/arena/rooms/v1/room-1/${role === 'host' ? 'close' : 'leave'}`,
        // 会话以 ready 结束后自动回到大厅并刷新公开房间列表（回归：显示暂无公开房间）
        '/api/arena/rooms/v1',
      ]);
      expect(document.body.textContent).toContain('两种最简单的玩法');
      expect(document.body.textContent).toContain('两种最简单的玩法');
      expect(JSON.parse(String(roomCalls[4]?.init?.body))).toEqual({
        expectedRoomEpoch: 'epoch-1',
      });
      expect(new Headers(roomCalls[1]?.init?.headers).get('authorization'))
        .toBe('Bearer verified-key');
    },
  );

  it('复制邀请使用当前浏览站点 origin，不复用 Hono API origin', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    try {
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith('/languages.json')) return Response.json([]);
        if (requestPath(url) === '/api/auth/verify') return Response.json({ success: false });
        if (requestPath(url) === '/api/arena/rooms/v1') {
          return Response.json({ protocolVersion: 1, items: [], nextCursor: null });
        }
        if (url.endsWith('/join')) return Response.json(sessionFor('host'));
        if (url.endsWith('/ticket')) return Response.json({
          protocolVersion: 1,
          ticket: 'ticket-invite',
          expiresInSeconds: 45,
          websocket: {
            path: '/api/arena/rooms/v1/ws',
            protocol: 'mahoshojo.arena-room.v1',
          },
        });
        if (url.endsWith('/generations')) {
          return Response.json({ protocolVersion: 1, roomId: 'room-1', roomEpoch: 'epoch-1', items: [] });
        }
        throw new Error(`unexpected Room request: ${url}`);
      });
      vi.stubGlobal('fetch', fetcher);
      await act(async () => root.render(productionTree(props)));
      await enterJoinCode();
      await act(async () => button('加入房间').click());
      await flush();
      await act(async () => WiringSocket.instances[0]!.open());

      await act(async () => button('分享房间').click());
      await flush();

      expect(writeText).toHaveBeenCalledTimes(1);
      const text = String(writeText.mock.calls[0]?.[0]);
      // 回归：props.origin 是 Hono API origin（此处 127.0.0.1:8787，生产为
      // homura.colanns.me），邀请链接必须指向用户正在浏览的 Web 站点。
      expect(text).toContain(`${window.location.origin}/arena`);
      expect(text).toContain('room-1');
      expect(text).not.toContain('127.0.0.1:8787');
    } finally {
      delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('真实 hook 对 1013 取 fresh ticket，对 membership revoke 显示 replacement 并可 reset', async () => {
    vi.useFakeTimers();
    let ticketIndex = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (requestPath(url) === '/api/arena/rooms/v1') {
        return Response.json({ protocolVersion: 1, items: [], nextCursor: null });
      }
      if (url.endsWith('/join')) return Response.json(sessionFor('member'));
      if (url.endsWith('/generations')) {
        return Response.json({ protocolVersion: 1, roomId: 'room-1', roomEpoch: 'epoch-1', items: [] });
      }
      if (url.endsWith('/ticket')) {
        ticketIndex += 1;
        return Response.json({
          protocolVersion: 1,
          ticket: `ticket-${ticketIndex}`,
          expiresInSeconds: 45,
          websocket: {
            path: '/api/arena/rooms/v1/ws',
            protocol: 'mahoshojo.arena-room.v1',
          },
        });
      }
      throw new Error(`unexpected Room request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(productionTree(props)));
    await enterJoinCode();
    await act(async () => button('加入房间').click());
    await flush();
    await act(async () => WiringSocket.instances[0]!.open());

    await act(async () => WiringSocket.instances[0]!.closed(1013, 'authority-unavailable'));
    expect(container.textContent).toContain('正在重新连接');
    await act(async () => {
      // 默认重连延迟叠加 0.8–1.2× 乘性 jitter（基线 500ms），推进到上界 600ms
      // 才能对任意 RNG 结果确定性命中重连。
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(WiringSocket.instances).toHaveLength(2);
    expect(ticketIndex).toBe(2);

    await act(async () => WiringSocket.instances[1]!.open());
    await act(async () => WiringSocket.instances[1]!.closed(1008, 'membership-revoked'));
    expect(container.textContent).toContain('原房间无法恢复');
    await act(async () => button('返回房间大厅').click());
    expect(container.textContent).toContain('打开多人房间');
  });

  it('panelUi 桥接：runtime 外部入口可打开房主配置/提案 Modal（回归：底部大按钮共享状态）', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (requestPath(url) === '/api/arena/rooms/v1') {
        return Response.json({ protocolVersion: 1, items: [], nextCursor: null });
      }
      if (url.endsWith('/join')) return Response.json(sessionFor('host'));
      if (url.endsWith('/generations')) {
        return Response.json({ protocolVersion: 1, roomId: 'room-1', roomEpoch: 'epoch-1', items: [] });
      }
      if (url.endsWith('/ticket')) {
        return Response.json({
          protocolVersion: 1,
          ticket: 'ticket-1',
          expiresInSeconds: 45,
          websocket: {
            path: '/api/arena/rooms/v1/ws',
            protocol: 'mahoshojo.arena-room.v1',
          },
        });
      }
      throw new Error(`unexpected Room request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(
      <ArenaRoomProvider
        enabled={props.enabled}
        authenticated={props.isAuthenticated && !props.authLoading}
        origin={props.origin}
      >
        <QueryClientProvider client={queryClient}>
          <PanelUiProbe />
          <ArenaMultiplayerContextPanel {...props} />
        </QueryClientProvider>
      </ArenaRoomProvider>,
    ));
    await flush();
    await enterJoinCode();
    await act(async () => button('加入房间').click());
    await flush();

    expect(document.body.textContent).not.toContain('成员在主编辑区编辑，房主在此逐项审阅配置变更。');
    await act(async () => button('probe-open-proposals').click());
    await flush();
    expect(document.body.textContent).toContain('成员在主编辑区编辑，房主在此逐项审阅配置变更。');
    await act(async () => button('probe-open-config').click());
    await flush();
    expect(document.body.textContent).toContain('房间设置在主编辑区修改；此面板处理本地编辑与房间的同步。');
  });

  it('member 通过 production panel/client/WSS 提交并撤回，HTTP ack 不越权修改 snapshot', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const memberSession = sessionFor('member');
    const battleBefore = useBattleStore.getState();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/languages.json')) return Response.json([]);
      if (requestPath(url) === '/api/auth/verify') return Response.json({ success: false });
      if (requestPath(url) === '/api/arena/rooms/v1') {
        return Response.json({ protocolVersion: 1, items: [], nextCursor: null });
      }
      if (url.endsWith('/join')) return Response.json(memberSession);
      if (url.endsWith('/ticket')) {
        return Response.json({
          protocolVersion: 1,
          ticket: `ticket-${calls.length}`,
          expiresInSeconds: 45,
          websocket: {
            path: '/api/arena/rooms/v1/ws',
            protocol: 'mahoshojo.arena-room.v1',
          },
        });
      }
      if (url.endsWith('/proposals')) {
        const intent = JSON.parse(String(init?.body)) as { proposalId: string };
        return Response.json({
          protocolVersion: 1,
          roomId: 'room-1',
          roomEpoch: 'epoch-1',
          controlSeq: 1,
          revision: 0,
          proposalId: intent.proposalId,
          status: 'submitted',
          result: 'applied',
        });
      }
      if (url.endsWith('/withdraw')) {
        const proposalId = decodeURIComponent(url.split('/proposals/')[1]!.split('/')[0]!);
        return Response.json({
          protocolVersion: 1,
          roomId: 'room-1',
          roomEpoch: 'epoch-1',
          controlSeq: 2,
          revision: 0,
          proposalId,
          status: 'withdrawn',
          result: 'applied',
        });
      }
      if (url.endsWith('/generations')) {
        return Response.json({ protocolVersion: 1, roomId: 'room-1', roomEpoch: 'epoch-1', items: [] });
      }
      throw new Error(`unexpected Room request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(productionTree(props)));
    await enterJoinCode();
    await act(async () => button('加入房间').click());
    await flush();
    await act(async () => WiringSocket.instances[0]!.open());

    expect(container.textContent).toContain('竞技场提案编辑模式');
    expect(document.body.querySelector('#arena-room-proposals-dialog-heading')).toBeNull();
    await setTextField('arena-story-guidance', 'production 成员建议');
    await act(async () => button('预览提案').click());
    expect(document.body.querySelectorAll('[role="dialog"][aria-modal="true"]')).toHaveLength(1);
    await act(async () => button('提交提案').click());
    await flush();

    const submitCall = calls.find((call) => requestPath(call.url).endsWith('/proposals'));
    if (!submitCall) throw new Error('submit call missing');
    const intent = JSON.parse(String(submitCall.init?.body)) as {
      proposalId: string;
      expectedRoomEpoch: string;
      baseRevision: number;
      changes: unknown[];
    };
    expect(intent).toMatchObject({
      expectedRoomEpoch: 'epoch-1',
      baseRevision: 0,
      changes: [{
        type: 'setUserGuidance',
        value: 'production 成员建议',
        expectedBase: { kind: 'value', value: '' },
      }],
    });
    expect(JSON.stringify(intent)).not.toMatch(/providerApiKey|userProviderConfig|credential/u);
    expect(container.textContent).not.toContain('我的待处理提案');
    expect(useBattleStore.getState()).toBe(battleBefore);

    const proposal = {
      proposalVersion: 1,
      proposalId: intent.proposalId,
      roomId: 'room-1',
      authorUserId: 'user-member',
      baseRevision: 0,
      status: 'submitted',
      changes: intent.changes,
      createdAt: '2026-08-28T00:01:00.000Z',
    };
    await act(async () => WiringSocket.instances[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:01:00.000Z',
      type: 'proposal.submitted',
      payload: { proposal },
    })));
    expect(container.textContent).toContain('我的待处理提案');

    await act(async () => button('撤回提案').click());
    await flush();
    const withdrawCall = calls.find((call) => requestPath(call.url).endsWith('/withdraw'));
    expect(JSON.parse(String(withdrawCall?.init?.body))).toEqual({
      expectedRoomEpoch: 'epoch-1',
    });
    expect(container.textContent).toContain('我的待处理提案');

    await act(async () => WiringSocket.instances[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 2,
      timestamp: '2026-08-28T00:02:00.000Z',
      type: 'proposal.resolved',
      payload: { proposalId: intent.proposalId, status: 'withdrawn' },
    })));
    expect(container.textContent).not.toContain(intent.proposalId);
  });

  it('host production Proposal 审阅携带 epoch/revision/selection fence，并等待 WSS resolve', async () => {
    const proposal = {
      proposalVersion: 1,
      proposalId: 'proposal-host-review',
      roomId: 'room-1',
      authorUserId: 'user-member',
      baseRevision: 0,
      status: 'submitted',
      changes: [{
        changeId: 'guidance-1',
        type: 'setUserGuidance',
        value: '成员建议',
        expectedBase: { kind: 'value', value: '' },
      }],
      createdAt: '2026-08-28T00:01:00.000Z',
    };
    const hostSession = sessionFor('host');
    hostSession.snapshot.members.push({
      userId: 'user-member',
      role: 'member',
      displayName: '成员',
      membershipState: 'active',
    });
    hostSession.snapshot.proposals.push(proposal);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (requestPath(url) === '/api/arena/rooms/v1') {
        return Response.json({ protocolVersion: 1, items: [], nextCursor: null });
      }
      if (url.endsWith('/join')) return Response.json(hostSession);
      if (url.endsWith('/ticket')) return Response.json({
        protocolVersion: 1,
        ticket: 'ticket-host',
        expiresInSeconds: 45,
        websocket: {
          path: '/api/arena/rooms/v1/ws',
          protocol: 'mahoshojo.arena-room.v1',
        },
      });
      if (url.endsWith('/resolve')) return Response.json({
        protocolVersion: 1,
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        controlSeq: 2,
        revision: 1,
        proposalId: proposal.proposalId,
        status: 'accepted',
        result: 'applied',
      });
      if (url.endsWith('/generations')) {
        return Response.json({ protocolVersion: 1, roomId: 'room-1', roomEpoch: 'epoch-1', items: [] });
      }
      throw new Error(`unexpected Room request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(productionTree(props)));
    await enterJoinCode();
    await act(async () => button('加入房间').click());
    await flush();
    await act(async () => WiringSocket.instances[0]!.open());

    await act(async () => button('提案').click());
    expect(document.body.querySelectorAll('[role="dialog"][aria-modal="true"]')).toHaveLength(1);
    await act(async () => button('接受所选').click());
    await flush();
    const resolveCall = calls.find((call) => requestPath(call.url).endsWith('/resolve'));
    expect(JSON.parse(String(resolveCall?.init?.body))).toEqual({
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
    });
    expect(document.body.textContent).toContain(proposal.proposalId);

    await act(async () => WiringSocket.instances[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 1,
      timestamp: '2026-08-28T00:02:00.000Z',
      type: 'room.config.updated',
      payload: { revision: 1, sharedConfig: { ...sharedConfig, userGuidance: '成员建议' } },
    })));
    await act(async () => WiringSocket.instances[0]!.message(JSON.stringify({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 2,
      timestamp: '2026-08-28T00:02:00.000Z',
      type: 'proposal.resolved',
      payload: { proposalId: proposal.proposalId, status: 'accepted' },
    })));
    expect(document.body.textContent).not.toContain(proposal.proposalId);
  });

  it('malformed Proposal 2xx 只发一次并冻结，projected session snapshot 对账后才解锁', async () => {
    const memberSession = sessionFor('member');
    let proposalCalls = 0;
    let ticketIndex = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/languages.json')) return Response.json([]);
      if (requestPath(url) === '/api/auth/verify') return Response.json({ success: false });
      if (requestPath(url) === '/api/arena/rooms/v1') {
        return Response.json({ protocolVersion: 1, items: [], nextCursor: null });
      }
      if (url.endsWith('/join')) return Response.json(memberSession);
      if (url.endsWith('/ticket')) {
        ticketIndex += 1;
        return Response.json({
          protocolVersion: 1,
          ticket: `ticket-${ticketIndex}`,
          expiresInSeconds: 45,
          websocket: {
            path: '/api/arena/rooms/v1/ws',
            protocol: 'mahoshojo.arena-room.v1',
          },
        });
      }
      if (url.endsWith('/proposals')) {
        proposalCalls += 1;
        return Response.json({ ok: true, malformed: true });
      }
      if (url.endsWith('/session')) {
        return Response.json({
          ...memberSession,
          snapshot: { ...memberSession.snapshot, controlSeq: 1, proposals: [] },
        });
      }
      if (url.endsWith('/generations')) {
        return Response.json({ protocolVersion: 1, roomId: 'room-1', roomEpoch: 'epoch-1', items: [] });
      }
      throw new Error(`unexpected Room request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(productionTree(props)));
    await enterJoinCode();
    await act(async () => button('加入房间').click());
    await flush();
    await act(async () => WiringSocket.instances[0]!.open());
    expect(container.textContent).toContain('竞技场提案编辑模式');
    await setTextField('arena-story-guidance', 'unknown 对账建议');
    await act(async () => button('预览提案').click());
    await act(async () => button('提交提案').click());
    await flush();

    expect(proposalCalls).toBe(1);
    expect(container.textContent).toContain('上次提案请求结果未知');
    expect(button('预览提案').disabled).toBe(true);
    await act(async () => button('预览提案').click());
    await flush();
    expect(proposalCalls).toBe(1);

    await act(async () => button('重新连接并对账').click());
    await flush();
    expect(fetcher.mock.calls.some(([input]) => String(input).endsWith('/session'))).toBe(true);
    expect(ticketIndex).toBe(2);
    expect(WiringSocket.instances).toHaveLength(2);
    expect(container.textContent).not.toContain('上次提案请求结果未知');
  });
});
