import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PresetGridPicker } from '@/components/PresetGridPicker';
import { ScenarioPresetGridPicker } from '@/components/ScenarioPresetGridPicker';

describe('Arena shared preset picker accessibility', () => {
  it('character cards expose native toggle buttons and mobile-sized actions', () => {
    const html = renderToStaticMarkup(
      <PresetGridPicker
        title="选择预设角色"
        presets={[
          { name: '角色一', description: '描述一', filename: 'one.json', type: 'magical-girl' },
          { name: '角色二', description: '描述二', filename: 'two.json', type: 'canshou' },
          { name: '角色三', description: '描述三', filename: 'three.json', type: 'magical-girl' },
          { name: '角色四', description: '描述四', filename: 'four.json', type: 'magical-girl' },
          { name: '角色五', description: '描述五', filename: 'five.json', type: 'magical-girl' },
        ]}
        currentPage={1}
        onPageChange={vi.fn()}
        selectedFilenames={['one.json']}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain('<button type="button" aria-label="取消选择预设角色：角色一" aria-pressed="true"');
    expect(html).toContain('<button type="button" aria-label="选择预设角色：角色二" aria-pressed="false"');
    expect(html).toMatch(/aria-label="下载预设：角色一"[^>]*h-6 w-6/u);
    expect(html).toMatch(/aria-label="下载预设：角色一"[^>]*after:-inset-2/u);
    expect(html).not.toMatch(/aria-label="下载预设：角色一"[^>]*min-(?:h-10|w-10)/u);
    expect(html).toMatch(/>下一页<\/button>/u);
    expect(html).toMatch(/<button[^>]*min-h-10[^>]*>下一页<\/button>/u);
  });

  it('scenario cards expose the same native toggle semantics', () => {
    const html = renderToStaticMarkup(
      <ScenarioPresetGridPicker
        title="选择预设情景"
        presets={[{
          title: '情景一',
          description: '情景描述',
          filename: 'scenario.json',
          template: 'scenario',
        }]}
        currentPage={1}
        onPageChange={vi.fn()}
        selectedFilenames={[]}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain('<button type="button" aria-label="选择预设情景：情景一" aria-pressed="false"');
    expect(html).toMatch(/aria-label="下载预设情景：情景一"[^>]*h-6 w-6/u);
    expect(html).toMatch(/aria-label="下载预设情景：情景一"[^>]*after:-inset-2/u);
    expect(html).not.toMatch(/aria-label="下载预设情景：情景一"[^>]*min-(?:h-10|w-10)/u);
  });
});
