// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuestionnaireLanguageSection } from '../src/details-controls/index';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('keeps the disclosure linked to its panel and preserves the selected language across collapse', () => {
  function Host() {
    const [expanded, setExpanded] = useState(false);
    const [value, setValue] = useState('zh-CN');
    return <QuestionnaireLanguageSection variant="canshou" expanded={expanded} onToggle={() => setExpanded(!expanded)} languages={[{ code: 'zh-CN', name: '简体中文' }, { code: 'en', name: 'English' }]} value={value} onChange={setValue} />;
  }
  act(() => root.render(<Host />));
  const button = container.querySelector('button')!;
  const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(panel.hidden).toBe(true);
  act(() => button.click());
  expect(button.getAttribute('aria-expanded')).toBe('true');
  const select = container.querySelector('select')!;
  expect(select.getAttribute('aria-label')).toBe('生成语言');
  act(() => { select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  act(() => button.click());
  act(() => button.click());
  expect(container.querySelector('select')?.value).toBe('en');
});

it('keeps a host fallback language and the generation disable gate', () => {
  act(() => root.render(<QuestionnaireLanguageSection variant="details" expanded onToggle={vi.fn()} languages={[{ code: 'custom', name: '当前语言' }]} value="custom" onChange={vi.fn()} disabled />));
  expect(container.querySelector('select')?.value).toBe('custom');
  expect(container.querySelector('select')?.disabled).toBe(true);
});
