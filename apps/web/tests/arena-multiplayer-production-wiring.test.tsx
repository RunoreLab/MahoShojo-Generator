// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArenaMultiplayerPanel } from '@/components/arena/multiplayer/ArenaMultiplayerPanel';
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

  closed(code: number, reason: string): void {
    this.onclose?.({ code, reason });
  }
}

let container: HTMLDivElement;
let root: Root;

const props = {
  enabled: true,
  origin: 'http://127.0.0.1:8787',
  authLoading: false,
  isAuthenticated: true,
  displayName: '测试玩家',
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const button = (label: string): HTMLButtonElement => {
  const match = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
};

const enterJoinCode = async (): Promise<void> => {
  const input = container.querySelector<HTMLInputElement>('#arena-room-join-code');
  if (!input) throw new Error('join input missing');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      ?.call(input, 'room-1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  WiringSocket.instances = [];
  vi.stubGlobal('WebSocket', WiringSocket);
  vi.spyOn(authStorage, 'getAuthHeader').mockResolvedValue('Bearer verified-key');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Arena multiplayer production client/hook wiring', () => {
  it('disabled/unauthenticated 的真实 hook 不读取 auth、不发 fetch、不建 WSS', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    await act(async () => root.render(
      <ArenaMultiplayerPanel {...props} enabled={false} />,
    ));
    await flush();
    expect(container.innerHTML).toBe('');

    await act(async () => root.render(
      <ArenaMultiplayerPanel {...props} isAuthenticated={false} />,
    ));
    await flush();
    expect(container.textContent).toContain('多人房间需要登录后使用');
    expect(fetcher).not.toHaveBeenCalled();
    expect(authStorage.getAuthHeader).not.toHaveBeenCalled();
    expect(WiringSocket.instances).toHaveLength(0);
  });

  it.each(['host', 'member'] as const)(
    '%s 通过真实 client/hook 完成 join -> ticket -> WSS -> exit epoch fence',
    async (role) => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const session = sessionFor(role);
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith('/join')) return Response.json(session);
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
      await act(async () => root.render(<ArenaMultiplayerPanel {...props} />));
      await enterJoinCode();
      await act(async () => button('加入房间').click());
      await flush();

      expect(WiringSocket.instances).toHaveLength(1);
      expect(WiringSocket.instances[0]).toMatchObject({
        url: 'ws://127.0.0.1:8787/api/arena/rooms/v1/ws?ticket=ticket-2',
        protocol: 'mahoshojo.arena-room.v1',
      });
      await act(async () => WiringSocket.instances[0]!.open());
      const exitLabel = role === 'host' ? '关闭房间' : '离开房间';
      await act(async () => button(exitLabel).click());
      await flush();

      expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
        '/api/arena/rooms/v1/room-1/join',
        '/api/arena/rooms/v1/room-1/ticket',
        `/api/arena/rooms/v1/room-1/${role === 'host' ? 'close' : 'leave'}`,
      ]);
      expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
        expectedRoomEpoch: 'epoch-1',
      });
      expect(new Headers(calls[0]?.init?.headers).get('authorization'))
        .toBe('Bearer verified-key');
    },
  );

  it('真实 hook 对 1013 取 fresh ticket，对 membership revoke 显示 replacement 并可 reset', async () => {
    vi.useFakeTimers();
    let ticketIndex = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/join')) return Response.json(sessionFor('member'));
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
    await act(async () => root.render(<ArenaMultiplayerPanel {...props} />));
    await enterJoinCode();
    await act(async () => button('加入房间').click());
    await flush();
    await act(async () => WiringSocket.instances[0]!.open());

    await act(async () => WiringSocket.instances[0]!.closed(1013, 'authority-unavailable'));
    expect(container.textContent).toContain('正在重新连接');
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(WiringSocket.instances).toHaveLength(2);
    expect(ticketIndex).toBe(2);

    await act(async () => WiringSocket.instances[1]!.open());
    await act(async () => WiringSocket.instances[1]!.closed(1008, 'membership-revoked'));
    expect(container.textContent).toContain('原房间无法恢复');
    await act(async () => button('返回房间大厅').click());
    expect(container.textContent).toContain('创建多人房间');
  });
});
