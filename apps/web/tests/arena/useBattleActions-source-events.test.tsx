// @vitest-environment jsdom

import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBattleActions } from '@/components/arena/hooks/useBattleActions';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import type { AdjudicatorEvent } from '@/types/arena';

vi.mock('@/lib/arena/verify-origin', () => ({ verifyArenaContentOrigin: vi.fn(async () => false) }));

const event = (id: string): AdjudicatorEvent => ({ id, description: id, type: 'binary', probability: 50 });
const scenario = (events: unknown = [event('inherited')]) => ({
  templateId: '通用情景', title: '测试情景', content: '测试正文', adjudicationEvents: events,
});
const card = (id: string, events?: unknown) => ({ ...scenario(events), _cardId: id, _cardName: id, _cardType: 'scenario' });
const file = (name: string, payload: unknown) => ({ name, text: async () => JSON.stringify(payload) }) as File;
let root: Root;
let container: HTMLDivElement;
let actions: ReturnType<typeof useBattleActions>;
const Harness = () => {
  const current = useBattleActions();
  useEffect(() => { actions = current; }, [current]);
  return null;
};
const ids = () => useBattleStore.getState().adjudicationEvents.map((entry) => entry.id);

beforeEach(async () => {
  localStorage.clear();
  useBattleStore.setState(useBattleStore.getInitialState(), true);
  useBattleStore.setState({ battleMode: 'scenario', adjudicationEvents: [event('manual')] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('Web 真实高级输入消费共源来源规则', () => {
  it('主情景切换清旧来源；辅助上传重复仅替换事件且移除沿同 key 全局过滤', async () => {
    await act(async () => actions.handleScenarioPaste(JSON.stringify(scenario([event('main')])), { fileName: 'main.json' }));
    await act(async () => actions.handleAuxScenarioUpload(file('aux.json', scenario([event('aux-old')]))));
    await act(async () => actions.handleAuxScenarioUpload(file('aux.json', scenario([event('aux-new')]))));
    expect(useBattleStore.getState().auxScenarios).toHaveLength(2);
    expect(ids()).toEqual(['manual', 'main', 'aux-new']);
    expect(useBattleStore.getState().adjudicationEvents[2].sourceKey).toBe('file:aux.json');
    await act(async () => actions.removeAuxScenario(useBattleStore.getState().auxScenarios[0].id));
    expect(useBattleStore.getState().auxScenarios).toHaveLength(1);
    expect(ids()).toEqual(['manual', 'main']);
    await act(async () => actions.handleScenarioUpload(file('next.json', scenario([event('main-next')]))));
    expect(ids()).toEqual(['manual', 'main-next']);
    await act(async () => useBattleStore.getState().clearScenario());
    expect(ids()).toEqual(['manual']);
  });

  it('辅助粘贴的空/旧版事件保持 early-return；有效输入才替换，不累计', async () => {
    await act(async () => actions.handleScenarioPaste(JSON.stringify(scenario([]))));
    const paste = async (input: unknown) => act(async () => actions.handleAuxScenarioPaste(JSON.stringify(scenario(input)), { fileName: 'aux.json' }));
    await paste([event('aux')]);
    const inherited = useBattleStore.getState().adjudicationEvents;
    await paste([]);
    expect(useBattleStore.getState().adjudicationEvents).toBe(inherited);
    await paste([{ event: '旧版', probability: 60 }]);
    expect(useBattleStore.getState().adjudicationEvents).toBe(inherited);
    await paste([event('replacement')]);
    expect(ids()).toEqual(['manual', 'replacement']);
    await act(async () => actions.clearAuxScenarios());
    expect(ids()).toEqual(['manual']);
  });

  it('云选择 card ID 优先；取消选中清来源；素材/Lore 内嵌不进入运行列表', async () => {
    await act(async () => actions.handleSelectDataCard(card('main-card', [event('main')])));
    await act(async () => actions.handleToggleAuxScenarioDataCard(card('aux-card', [event('aux')]), true));
    expect(useBattleStore.getState().error).toBeNull();
    expect(useBattleStore.getState().adjudicationEvents.map((entry) => entry.sourceKey)).toEqual([undefined, 'data_card:main-card', 'data_card:aux-card']);
    await act(async () => actions.handleToggleAuxScenarioDataCard(card('aux-card', [event('unused')]), false));
    expect(ids()).toEqual(['manual', 'main']);
    await act(async () => actions.handleSelectDataCard({ templateId: '通用角色', name: '角色', content: '设定', _cardId: 'character-card', _cardName: '角色', adjudicationEvents: [event('character')] }));
    expect(ids()).toEqual(['manual', 'main', 'character']);
    expect(useBattleStore.getState().adjudicationEvents[2].sourceKey).toBe('data_card:character-card');
    await act(async () => useBattleStore.getState().removeCombatant('character-card'));
    expect(ids()).toEqual(['manual', 'main']);
    await act(async () => actions.handleMaterialPaste(JSON.stringify(scenario([event('material-embedded')]))));
    const questionnaire = { id: 'lore', title: '设定', kind: 'magical-girl' as const, questions: [], loreMarkdown: '设定文本', adjudicationEvents: [event('lore-embedded')] };
    await act(async () => useBattleStore.getState().addQuestionnaireSelection({ source: 'upload', questionnaire }));
    expect(ids()).toEqual(['manual', 'main']);
  });
});
