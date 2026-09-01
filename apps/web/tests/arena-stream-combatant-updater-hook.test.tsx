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
});
