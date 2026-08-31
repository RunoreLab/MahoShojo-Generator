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
  unknownOperation: null,
  proposalOperation: null,
  proposalResultUnknown: false,
  generation: {
    mirror: null,
    phase: 'idle',
    status: null,
    authoritativeMarkdown: '',
    markdown: '',
    storyCursor: null,
    gap: null,
    finalAuthoritative: false,
    generationRecordId: null,
    errorCode: null,
    pendingRequestId: null,
    startResultUnknown: false,
  },
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
    onDiscoverMore={vi.fn()}
    onJoin={vi.fn()}
    onLeave={vi.fn()}
    onClose={vi.fn()}
    onReconnect={vi.fn()}
    onRetryUnknown={vi.fn()}
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

  it('ready view 只保留紧凑入口且不显示内部 Development Gate', () => {
    const html = render(readyState);
    expect(html).toContain('打开多人房间');
    expect(html).not.toContain('<fieldset');
    expect(html).not.toContain('创建多人房间');
    expect(html).not.toContain('Development Gate');
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

  it('显示多人生成预览，并明确区分权威终态与结果未知', () => {
    const completed = render({
      ...readyState,
      phase: 'connected',
      session,
      generation: {
        ...readyState.generation,
        phase: 'completed',
        status: 'completed',
        markdown: '# 最终战报',
        authoritativeMarkdown: '# 最终战报',
        finalAuthoritative: true,
        generationRecordId: 'record-1',
      },
    });
    expect(completed).toContain('房间战报');
    expect(completed).toContain('权威终态');
    expect(completed).toContain('# 最终战报');

    const unknown = render({
      ...readyState,
      phase: 'connected',
      session,
      generation: {
        ...readyState.generation,
        phase: 'unknown',
        pendingRequestId: 'request-unknown-1',
        startResultUnknown: true,
      },
    });
    expect(unknown).toContain('启动结果尚未确认');
    expect(unknown).toContain('不要重复提交');
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
      unknownOperation: 'create',
    });
    expect(html).toContain('服务器可能已经创建房间');
    expect(html).toContain('非公开房间');
    expect(html).toContain('重新确认创建结果');
    expect(html).toContain('已确认状态，返回大厅');
    expect(html).not.toContain('创建多人房间');

    const joinUnknown = render({
      ...readyState,
      phase: 'unknown',
      notice: '加入请求结果未知，请先确认房间状态',
      unknownOperation: 'join',
    });
    expect(joinUnknown).toContain('不会重复提交加入');
    expect(joinUnknown).toContain('重新确认加入结果');
  });
});
