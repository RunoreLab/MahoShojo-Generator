// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { BattleLitePageView, PresetGridPicker, ScenarioPickerPanel, type BattleLitePageViewProps } from '../src/arena';
describe('shared battle view capability boundary', () => {
  it('omits absent host sections and host-only download or online actions', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const slots: BattleLitePageViewProps['slots'] = { header: <h1>竞技场</h1>, rankingLinks: null, pageLinks: null,
      presets: <PresetGridPicker title="预设" presets={[{ name: '翠雀', filename: 'a.json', description: 'test' }]} currentPage={1} onPageChange={vi.fn()} selectedFilenames={[]} onToggle={vi.fn()} />,
      database: <div>本地选择</div>, localImport: null, roster: null, mode: <div>模式</div>,
      scenario: <ScenarioPickerPanel isAuthenticated={false} enableLocalInput={false} />,
      materials: null, storyOptions: <div>设置</div>, generationMode: null, actions: null, community: null, result: null, storySession: null, homeLink: null, footer: null };
    try {
      await act(async () => root.render(<BattleLitePageView isGenerating={false} presetCountLabel="0/32" combatantCountLabel="0/32" showScenario hasScenario={false} materialCount={0} referenceItemCount={0} maxReferenceItems={6} slots={slots} copy={{ databaseTitle: "本地库", databaseDescription: null, modeDescription: null, storyOptionsDescription: null }} />));
      expect(container.textContent).toContain('翠雀');
      expect(container.textContent).not.toContain('在线角色库');
      expect(container.textContent).not.toContain('社区');
      expect(container.textContent).toContain('本地库');
      expect(container.textContent).not.toContain('计分规则');
      expect(container.textContent).not.toContain('完整版竞技场');
      expect(container.textContent).not.toContain('当前已选');
      expect(container.textContent).not.toContain('浏览在线情景库');
      expect(container.querySelector('[download]')).toBeNull();
      expect(container.querySelector('a')).toBeNull();
      expect(container.querySelector('.battle-lite-shell .battle-lite-panel')).not.toBeNull();
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
