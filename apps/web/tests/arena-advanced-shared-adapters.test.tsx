// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaEditorWorkspaceLayout } from '@/components/arena/editor/ArenaEditorWorkspaceLayout';
import { QuestionnaireLorePanel } from '@/components/arena/components/QuestionnaireLorePanel';
import { BattleHeader } from '@/components/arena/components/BattleHeader';
import { AdjudicatorSettingsPanel } from '@/components/shared/AdjudicatorSettingsPanel';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/BattleDataModal', () => ({ default: () => null }));
vi.mock('@/components/DataCardDetailsModal', () => ({ default: () => null }));
vi.mock('@/components/shared/TokenIndicator', () => ({ TokenIndicator: ({ text }: { text: string }) => <span data-token-text={text} /> }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); useBattleStore.setState({ selectedQuestionnaires: [], auxScenarios: [], materials: [], isGenerating: false }); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ presets: [] }) }))); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
async function click(text: string) { const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text)); expect(button).toBeTruthy(); await act(async () => button!.click()); }
describe('real Web advanced adapters', () => {
  it('keeps existing section title/storage key/default mount behavior', async () => {
    localStorage.setItem('arena.section.storyOptions.open', '0');
    await act(async () => root.render(<ArenaEditorWorkspaceLayout sections={[{ kind: 'story', description: 'original description', defaultOpen: true, keepMounted: true, content: <input aria-label="preserved draft" /> }]} />));
    expect(container.textContent).toContain('🧠 故事引导 / 判定 / AI 模型'); expect(container.querySelector('input')?.parentElement?.hidden).toBe(true); await click('故事引导'); expect(localStorage.getItem('arena.section.storyOptions.open')).toBe('1');
  });
  it('Lore paste/enable/reorder/remove mutate actual Web store and shared token input', async () => {
    await act(async () => root.render(<QuestionnaireLorePanel />));
    for (const id of ['A', 'B']) {
      await click('粘贴 JSON'); const field = container.querySelector('textarea')!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, JSON.stringify({ id, kind: 'magical-girl', title: id, questions: [], loreMarkdown: `lore-${id}` })); field.dispatchEvent(new Event('input', { bubbles: true })); }); await click('导入');
    }
    expect(useBattleStore.getState().selectedQuestionnaires.map((entry) => entry.questionnaire.id)).toEqual(['A', 'B']); expect(container.querySelector('[data-token-text]')?.getAttribute('data-token-text')).toContain('lore-A');
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click()); expect(useBattleStore.getState().selectedQuestionnaires[0].useLore).toBe(false);
    await act(async () => (container.querySelector('[aria-label="下移 A"]') as HTMLButtonElement).click()); expect(useBattleStore.getState().selectedQuestionnaires[0].questionnaire.id).toBe('B'); await click('移除'); expect(useBattleStore.getState().selectedQuestionnaires).toHaveLength(1);
  });
  it('adjudicator wrapper renders actual shared editor with disabled controls', async () => {
    const changed = vi.fn(); await act(async () => root.render(<AdjudicatorSettingsPanel events={[]} disabled onEventsChange={changed} />)); const button = container.querySelector('fieldset button') as HTMLButtonElement; expect(button.matches(':disabled')).toBe(true); await act(async () => button.click()); expect(changed).not.toHaveBeenCalled();
  });
  it('full header wrapper keeps the original guide, links, logo and disclosure key', async () => {
    await act(async () => root.render(<BattleHeader />));
    expect(container.querySelector('.subtitle')?.textContent).toBe('能亲眼见到强者之战，这下就算死也会值回票价呀！');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('魔法少女竞技场');
    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(expect.arrayContaining(['/battle', '/details', '/canshou']));
    expect(container.textContent).toContain('本页是完整版竞技场'); expect(container.textContent).toContain('收集至少 2 位角色的设定文件');
    await click('使用须知'); expect(localStorage.getItem('arena.section.guide.open')).toBe('0'); expect(container.querySelector('ol')).toBeNull();
  });

});
