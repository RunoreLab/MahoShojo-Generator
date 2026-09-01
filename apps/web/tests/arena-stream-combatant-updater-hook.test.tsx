// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  authStorage: {},
}));
vi.mock('@/lib/hono-api-client', () => ({
  buildGenerationApiHeaders: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/arena/resumable-generation-client', () => ({
  withArenaGenerationActorToken: (headers: Record<string, string>) => headers,
}));

import { useStreamCombatantUpdater } from '@/components/arena/hooks/useStreamCombatantUpdater';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

let currentHook: ReturnType<typeof useStreamCombatantUpdater> | null = null;

const Harness = () => {
  currentHook = useStreamCombatantUpdater();
  return null;
};

afterEach(() => {
  currentHook = null;
  vi.unstubAllGlobals();
  useBattleStore.setState({
    combatants: [],
    updatedCombatants: [],
  });
});

describe('useStreamCombatantUpdater', () => {
  it('有 generationId 时不再用本地 Markdown 解析阻断权威对账', async () => {
    const combatant = {
      type: 'general-character' as const,
      filename: '角色-a.json',
      isValid: false,
      isPreset: false,
      data: { name: '角色 A' },
    };
    useBattleStore.setState({ combatants: [combatant], updatedCombatants: [] });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      updatedCombatants: [],
      warnings: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    if (!currentHook) throw new Error('updater hook 未挂载');

    await act(async () => currentHook!.updateFromMarkdown('', [combatant], 'classic', {
      userGuidance: '客户端不再上传',
      writeArenaHistory: true,
      writeCurrentState: false,
    }, null, undefined, 'generation-authoritative-001'));

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      generationId: 'generation-authoritative-001',
      combatants: [{
        type: 'general-character',
        data: { name: '角色 A' },
        isPreset: false,
        filename: '角色-a.json',
      }],
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it('服务端响应返回后上下文已失效时不写入 roster', async () => {
    const originalCombatant = {
      type: 'general-character' as const,
      filename: '角色-a.json',
      isValid: false,
      isPreset: false,
      data: { name: '角色 A', marker: 'original' },
    };
    useBattleStore.setState({
      combatants: [originalCombatant],
      updatedCombatants: [],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      updatedCombatants: [{ name: '角色 A', marker: 'stale-server-result' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    if (!currentHook) throw new Error('updater hook 未挂载');

    await expect(currentHook.updateCombatants({
      combatants: [{
        type: originalCombatant.type,
        data: originalCombatant.data,
        isNative: false,
        isPreset: false,
      }],
    }, {
      canCommit: () => false,
    })).rejects.toThrow('角色更新上下文已变化');

    expect(useBattleStore.getState().combatants).toEqual([originalCombatant]);
    expect(useBattleStore.getState().updatedCombatants).toEqual([]);

    await act(async () => root.unmount());
    container.remove();
  });

  it('重复角色名只按服务端返回的 combatantIndex 合并', async () => {
    const combatants = [
      {
        type: 'general-character' as const,
        filename: 'a.json',
        isValid: false,
        isPreset: false,
        data: { name: '同名角色', marker: 'first' },
      },
      {
        type: 'general-character' as const,
        filename: 'b.json',
        isValid: true,
        isPreset: false,
        data: { name: '同名角色', marker: 'second' },
      },
    ];
    useBattleStore.setState({ combatants, updatedCombatants: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      updatedCombatants: [{
        combatantIndex: 1,
        data: { name: '同名角色', marker: 'updated-second' },
        isNative: false,
      }],
      warnings: [{
        combatantIndex: 0,
        code: 'ARENA_RECONCILIATION_COMBATANT_UNMATCHED',
        message: '第一张角色未匹配，已跳过。',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    if (!currentHook) throw new Error('updater hook 未挂载');

    await act(async () => currentHook!.updateCombatants({
      generationId: 'generation-duplicate-name',
      combatants: combatants.map((combatant) => ({
        type: combatant.type,
        data: combatant.data,
        isNative: false,
        isPreset: false,
        filename: combatant.filename,
      })),
    }));

    expect(useBattleStore.getState().combatants.map((item) => (
      'data' in item ? item.data.marker : null
    ))).toEqual(['first', 'updated-second']);
    expect((useBattleStore.getState().combatants[1] as { isValid?: boolean }).isValid).toBe(false);
    expect(useBattleStore.getState().updatedCombatants).toEqual([
      { name: '同名角色', marker: 'updated-second' },
    ]);
    expect(currentHook.updateError).toContain('第一张角色未匹配');

    await act(async () => root.unmount());
    container.remove();
  });

  it('响应到达前 roster 被替换时不按旧 index 覆盖新卡', async () => {
    const originalCombatant = {
      type: 'general-character' as const,
      filename: 'a.json',
      isValid: false,
      isPreset: false,
      data: { name: '角色 A', marker: 'original' },
    };
    const replacement = {
      ...originalCombatant,
      filename: 'replacement.json',
      data: { name: '角色 B', marker: 'replacement' },
    };
    useBattleStore.setState({ combatants: [originalCombatant], updatedCombatants: [] });
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    })));

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    if (!currentHook) throw new Error('updater hook 未挂载');

    const pending = currentHook.updateCombatants({
      generationId: 'generation-race-001',
      combatants: [{
        type: originalCombatant.type,
        data: originalCombatant.data,
        isPreset: false,
        filename: originalCombatant.filename,
      }],
    });
    useBattleStore.setState({ combatants: [replacement] });
    resolveResponse(new Response(JSON.stringify({
      success: true,
      updatedCombatants: [{
        combatantIndex: 0,
        data: { name: '角色 A', marker: 'stale-result' },
        isNative: false,
      }],
      warnings: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(pending).rejects.toThrow('角色更新上下文已变化');
    expect(useBattleStore.getState().combatants).toEqual([replacement]);

    await act(async () => root.unmount());
    container.remove();
  });
});
