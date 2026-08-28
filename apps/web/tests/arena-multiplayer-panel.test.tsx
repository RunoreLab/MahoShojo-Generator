import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ArenaMultiplayerPanelView } from '@/components/arena/multiplayer/ArenaMultiplayerPanel';
import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';

const readyState: ArenaRoomControllerState = {
  phase: 'ready',
  rooms: [],
  session: null,
  notice: null,
  error: null,
};

const session = {
  protocolVersion: 1 as const,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  self: {
    userId: 'host-1',
    role: 'host' as const,
    displayName: '房主',
    membershipState: 'active' as const,
  },
  snapshot: {
    protocolVersion: 1 as const,
    schemaVersion: 1 as const,
    roomId: 'room-1',
    roomEpoch: 'epoch-1',
    revision: 0,
    controlSeq: 0,
    sharedConfig: {
      battleMode: 'classic' as const,
      combatants: [{
        key: 'host-local:character:1',
        displayName: '角色',
        type: 'magical-girl' as const,
        source: 'host-local' as const,
      }],
      teams: [],
      scenario: null,
      auxScenarios: [],
      materials: [],
      userGuidance: '',
      storyLength: 'default' as const,
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
    },
    members: [{
      userId: 'host-1',
      role: 'host' as const,
      displayName: '房主',
      membershipState: 'active' as const,
    }],
    proposals: [],
    activeGeneration: null,
  },
};

const render = (state: ArenaRoomControllerState, overrides = {}) => renderToStaticMarkup(
  <ArenaMultiplayerPanelView
    state={state}
    authLoading={false}
    roomTitle="测试房"
    visibility="public"
    joinCode=""
    onRoomTitleChange={vi.fn()}
    onVisibilityChange={vi.fn()}
    onJoinCodeChange={vi.fn()}
    onCreate={vi.fn()}
    onDiscover={vi.fn()}
    onJoin={vi.fn()}
    onLeave={vi.fn()}
    onClose={vi.fn()}
    onReconnect={vi.fn()}
    onReset={vi.fn()}
    {...overrides}
  />,
);

describe('Arena multiplayer panel accessibility/permissions', () => {
  it('未登录只显示门禁文案，不渲染 Room 操作', () => {
    const html = render({ ...readyState, phase: 'unauthenticated' });
    expect(html).toContain('多人房间需要登录后使用');
    expect(html).not.toContain('创建多人房间');
    expect(html).not.toContain('/api/arena/rooms');
  });

  it('ready view 使用可访问 label/fieldset 与 keyboard button', () => {
    const html = render(readyState);
    expect(html).toContain('<fieldset');
    expect(html).toContain('for="arena-room-title"');
    expect(html).toContain('id="arena-room-title"');
    expect(html).toContain('for="arena-room-join-code"');
    expect(html).toContain('创建多人房间');
    expect(html).toContain('发现公开房间');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-live="polite"');
  });

  it('host/member 权限与 server contract 对齐', () => {
    const hostHtml = render({ ...readyState, phase: 'connected', session });
    expect(hostHtml).toContain('关闭房间');
    expect(hostHtml).not.toContain('离开房间');

    const memberSession = {
      ...session,
      self: { ...session.self, userId: 'member-1', role: 'member' as const, displayName: '成员' },
      snapshot: {
        ...session.snapshot,
        members: [
          session.snapshot.members[0]!,
          { userId: 'member-1', role: 'member' as const, displayName: '成员', membershipState: 'active' as const },
        ],
      },
    };
    const memberHtml = render({
      ...readyState,
      phase: 'connected',
      session: memberSession,
    });
    expect(memberHtml).toContain('离开房间');
    expect(memberHtml).not.toContain('关闭房间');
  });

  it('重连/降级/replacement 文案明确，不声称透明 failover', () => {
    const reconnecting = render({
      ...readyState,
      phase: 'reconnecting',
      session,
      notice: '正在重新连接…',
    });
    expect(reconnecting).toContain('正在重新连接…');
    const degraded = render({
      ...readyState,
      phase: 'degraded',
      session,
      notice: '房间运行时暂不可用，正在重试',
    });
    expect(degraded).toContain('房间运行时暂不可用，正在重试');
    const replacement = render({
      ...readyState,
      phase: 'replacement',
      session,
      notice: '原房间无法恢复，请房主创建新房间',
    });
    expect(replacement).toContain('原房间无法恢复，请房主创建新房间');
    for (const html of [reconnecting, degraded, replacement]) {
      expect(html).not.toContain('无缝');
      expect(html).not.toContain('透明');
    }
  });

  it('create 结果未知时隐藏重复创建入口并提供显式对账动作', () => {
    const html = render({
      ...readyState,
      phase: 'unknown',
      notice: '请求可能已提交，请先确认房间状态，不要重复提交',
    });
    expect(html).toContain('服务器可能已经创建房间');
    expect(html).toContain('检查公开房间');
    expect(html).toContain('已确认状态，返回大厅');
    expect(html).not.toContain('创建多人房间');
  });
});
