// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ScenarioResultContent } from '../src/scenario/index';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (data: unknown) => act(() => root.render(<ScenarioResultContent data={data} />));

it('reads familiar fields while preserving extensions and exact JSON in a collapsed technical view', () => {
  const data = { title: '天文台', description: '  星轨\n记录  ', elements: { scene: { time: '午夜', place: '山顶', features: '圆顶' }, roles: [{ name: '守夜人', description: '记录星轨' }], events: '调查', atmosphere: '安静', development: ['发现线索'] }, future_extension: { keep: ['完整', 42] }, metadata: { signature: 'not-verification' } };
  const before = JSON.stringify(data);
  render(data);
  const preview = container.querySelector('[aria-label="情景内容预览"]')!;
  expect(preview.textContent).toContain('  星轨\n记录  ');
  expect(preview.textContent).toContain('守夜人：记录星轨');
  expect(preview.textContent).toContain('发现线索');
  expect(preview.textContent).not.toContain('not-verification');
  expect(container.querySelector('details')?.open).toBe(false);
  expect(container.querySelector('summary')?.textContent).toBe('完整 JSON（技术视图）');
  expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(data, null, 2));
  expect(JSON.stringify(data)).toBe(before);
});

it('keeps unsupported and malformed cards visible as unmodified JSON without forcing a domain schema', () => {
  for (const data of [{ title: '自定义', elements: 'legacy', extra: [1, 2] }, { elements: { roles: [null, 4, { name: {} }], development: [null, {}] } }, null, ['custom']]) {
    render(data);
    expect(container.textContent).toContain('没有可展示的常用字段');
    expect(container.querySelector('details')?.open).toBe(true);
    expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(data, null, 2));
  }
});

it('renders text safely, and a later card refreshes both preview and full source without mutating callbacks', () => {
  render({ description: '<img src=x onerror=alert(1)>', elements: {} });
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('dd')?.textContent).toBe('<img src=x onerror=alert(1)>');
  const next = { description: '新结果', elements: { events: '继续' }, extra: '完整保留' };
  render(next);
  expect(container.querySelector('dd')?.textContent).toBe('新结果');
  expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(next, null, 2));
});
