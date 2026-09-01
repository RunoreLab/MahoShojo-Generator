// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startCooldown: vi.fn(),
  getAuthHeader: vi.fn().mockResolvedValue('Bearer test-token'),
  getActivityHeaders: vi.fn().mockResolvedValue({ 'x-mahoshojo-user-id': '7' }),
}));

vi.mock('@/lib/cooldown', () => ({
  useProviderModeCooldown: () => ({
    isCooldown: false,
    remainingTime: 0,
    startCooldown: mocks.startCooldown,
  }),
}));
vi.mock('@/lib/auth', () => ({
  authStorage: {
    getAuthHeader: mocks.getAuthHeader,
    getActivityHeaders: mocks.getActivityHeaders,
  },
}));
vi.mock('@/components/arena/multiplayer/useArenaRoom', () => ({
  useArenaRoomContext: () => null,
}));

import { useCombatantRepair } from '@/components/arena/hooks/useCombatantRepair';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

let currentHook: ReturnType<typeof useCombatantRepair> | null = null;

const Harness = () => {
  currentHook = useCombatantRepair();
  return <pre data-testid="draft">{currentHook.draftText}</pre>;
};

afterEach(() => {
  currentHook = null;
  vi.unstubAllGlobals();
  useBattleStore.setState({
    combatants: [],
    newsReport: null,
    streamingMarkdown: null,
    latestAiImpacts: null,
    updatedCombatants: [],
    lastGenerationId: null,
    repairAppliedGenerationId: null,
    isGenerating: false,
  });
});

describe('useCombatantRepair', () => {
  it('AI 成功只填充草稿，不自动修改 roster 或 repair 标记', async () => {
    const originalCombatant = {
      type: 'magical-girl' as const,
      filename: '角色-a.json',
      isValid: true,
      isPreset: false,
      data: { name: '角色 A', signature: 'signed-a' },
    };
    useBattleStore.setState((state) => ({
      combatants: [originalCombatant],
      generationMode: 'non-stream',
      newsReport: {
        headline: '终局战报',
        reporterInfo: { name: '记者', publication: '日报' },
        article: {
          body: '角色 A 在漫长的魔法竞技中完成了清晰且可验证的成长。'.repeat(8),
          analysis: '分析',
        },
        officialReport: { winner: '角色 A', conclusion: '战斗结束。' },
      },
      latestAiImpacts: null,
      updatedCombatants: [],
      lastGenerationId: 'generation-hook-repair-001',
      repairAppliedGenerationId: null,
      settings: {
        ...state.settings,
        writeArenaHistory: true,
        writeCurrentState: true,
        userGuidance: '保持角色既有性格',
      },
      battleMode: 'classic',
      isGenerating: false,
    }));

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      impacts: [{
        combatantIndex: 0,
        characterName: '角色 A',
        impact: 'AI 草稿影响',
        currentStateSummary: 'AI 草稿状态',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    if (!currentHook) throw new Error('repair hook 未挂载');

    await act(async () => currentHook!.generateAiRepairDraft());

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/arena/repair-combatant-meta');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'x-mahoshojo-user-id': '7',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      generationId: 'generation-hook-repair-001',
      mode: 'classic',
      writeArenaHistory: true,
      writeCurrentState: true,
      combatants: [{
        type: 'magical-girl',
        isNative: true,
        data: { name: '角色 A', signature: 'signed-a' },
      }],
    });
    expect(currentHook!.draftText).toContain('AI 草稿影响');
    expect(useBattleStore.getState().combatants).toEqual([originalCombatant]);
    expect(useBattleStore.getState().updatedCombatants).toEqual([]);
    expect(useBattleStore.getState().repairAppliedGenerationId).toBeNull();
    expect(mocks.startCooldown).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });
});
