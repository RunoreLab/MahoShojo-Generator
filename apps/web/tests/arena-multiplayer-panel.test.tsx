import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ArenaMultiplayerPanelView,
  ArenaRoomGenerationResult,
} from '@/components/arena/multiplayer/ArenaMultiplayerPanel';
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

  it('紧凑入口与房间壳都提供玩法说明百科直达链接', () => {
    const compactHtml = render(readyState);
    expect(compactHtml).toContain('玩法说明');
    expect(compactHtml).toContain('href="/encyclopedia/arena-multiplayer#快速开始"');

    const roomHtml = render({ ...readyState, phase: 'connected', session });
    expect(roomHtml).toContain('href="/encyclopedia/arena-multiplayer#房主与成员"');
  });

  it('连接后的默认状态文案按成员数量引导邀请', () => {
    const aloneHtml = render({ ...readyState, phase: 'connected', session });
    expect(aloneHtml).toContain('房间已连接；把房间码分享给朋友即可邀请加入');

    const withMemberSession = {
      ...session,
      snapshot: {
        ...session.snapshot,
        members: [
          session.snapshot.members[0]!,
          { userId: 'member-1', role: 'member' as const, displayName: '成员', membershipState: 'active' as const },
        ],
      },
    };
    const withMemberHtml = render({
      ...readyState,
      phase: 'connected',
      session: withMemberSession,
    });
    expect(withMemberHtml).toContain('房间已连接');
    expect(withMemberHtml).not.toContain('把房间码分享给朋友即可邀请加入');
  });

  it('无 session 的大厅入口仍播报 controller notice pending 状态', () => {
    const html = render({
      ...readyState,
      notice: '正在确认上一项房间请求，请稍候…',
    });
    expect(html).toContain('正在确认上一项房间请求，请稍候…');
    expect(html).toContain('role="status"');
  });

  it('历史战报入口在有已完成记录时显示有界数量', () => {
    const base = render({ ...readyState, phase: 'connected', session });
    expect(base).toContain('历史战报');

    const counted = render(
      { ...readyState, phase: 'connected', session },
      { generationHistoryCount: 3 },
    );
    expect(counted).toContain('历史战报（3）');

    const capped = render(
      { ...readyState, phase: 'connected', session },
      { generationHistoryCount: 0 },
    );
    expect(capped).not.toContain('历史战报（');
  });

  it('host/member 权限与 server contract 对齐', () => {
    const hostHtml = render({ ...readyState, phase: 'connected', session });
    expect(hostHtml).toContain('配置');
    expect(hostHtml).toContain('提案');
    expect(hostHtml).toContain('>房间</button>');
    expect(hostHtml).not.toContain('aria-label="房间成员列表"');
    expect(hostHtml).not.toContain('房间战报');
    expect(hostHtml).not.toContain('关闭房间');

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
    expect(memberHtml).not.toContain('同步配置');
    expect(memberHtml).toContain('提案');
    expect(memberHtml).toContain('>房间</button>');
    expect(memberHtml).not.toContain('房间管理 / 退出');
    expect(memberHtml).not.toContain('离开房间');
    expect(memberHtml).not.toContain('关闭房间');
  });

  it('仅向房主显示待处理提案数字 badge', () => {
    const proposal = {
      proposalVersion: 1 as const,
      proposalId: 'proposal-pending-1',
      roomId: 'room-1',
      authorUserId: 'member-1',
      baseRevision: 0,
      status: 'submitted' as const,
      changes: [{
        changeId: 'guidance-1',
        type: 'setUserGuidance' as const,
        value: '成员建议',
        expectedBase: { kind: 'value' as const, value: '' },
      }],
      createdAt: '2026-09-02T00:00:00.000Z',
    };
    const hostState = {
      ...readyState,
      phase: 'connected' as const,
      session: {
        ...session,
        snapshot: { ...session.snapshot, proposals: [proposal, { ...proposal, proposalId: 'proposal-pending-2' }] },
      },
    };
    const hostHtml = render(hostState);
    expect(hostHtml).toContain('aria-label="提案，2 个待处理"');
    expect(hostHtml).toContain('bg-red-600');

    const memberHtml = render({
      ...hostState,
      session: {
        ...hostState.session,
        self: { ...session.self, role: 'member' as const, userId: 'member-1' },
      },
    });
    expect(memberHtml).not.toContain('个待处理');
  });

  it('显示多人生成预览，并明确区分权威终态与结果未知', () => {
    const completedState: ArenaRoomControllerState = {
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
        result: {
          version: 1,
          format: 'stream-markdown',
          mode: 'classic',
          reporterInfo: { name: '房间记者', publication: 'Arena 日报' },
          ai: { model: 'safe-model-name' },
          combatantUpdates: [{
            combatantKey: 'host-local:character:1',
            displayName: '角色',
            impact: '守住了阵地',
          }],
        },
      },
    };
    const completed = renderToStaticMarkup(
      <ArenaRoomGenerationResult state={completedState} />,
    );
    expect(completed).toContain('房间战报');
    expect(completed).toContain('权威终态');
    expect(completed).toContain('data-arena-battle-result-presentation="v1"');
    expect(completed).toContain('最终战报');
    expect(completed).toContain('房间记者');
    expect(completed).toContain('战后角色变化');
    expect(completed).not.toContain('重做角色更新');
    expect(completed).not.toContain('应用手动修改');
    expect(completed).not.toContain('下载更新设定');
    expect(completed).not.toContain('保存到云端');

    const unknownState: ArenaRoomControllerState = {
      ...readyState,
      phase: 'connected',
      session,
      generation: {
        ...readyState.generation,
        phase: 'unknown',
        pendingRequestId: 'request-unknown-1',
        startResultUnknown: true,
      },
    };
    const unknown = renderToStaticMarkup(
      <ArenaRoomGenerationResult state={unknownState} />,
    );
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

  it('terminal phase 即使残留 session 也不渲染可交互房间壳', () => {
    for (const phase of ['closed', 'replacement'] as const) {
      const html = render({
        ...readyState,
        phase,
        session,
        notice: phase === 'closed' ? '已离开房间' : '原房间无法恢复',
      });
      expect(html).toContain('返回房间大厅');
      expect(html).toContain(phase === 'closed' ? '已离开房间' : '原房间无法恢复');
      expect(html).not.toContain('更新配置');
      expect(html).not.toContain('房间管理');
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
