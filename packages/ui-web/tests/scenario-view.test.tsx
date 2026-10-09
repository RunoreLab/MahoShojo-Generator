// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScenarioPageLayout, ScenarioResultSurface, ScenarioTitleField, ScenarioQuestionFields, ScenarioBlankFields, ScenarioLanguageField, SCENARIO_QUESTIONS } from '../src/scenario/index';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('keeps the common scenario brand and places output outside the input card', () => {
  const navigate = vi.fn();
  act(() => root.render(<ScenarioPageLayout onNavigate={navigate} resolveInternalHref={(href) => `#${href}`} controls={<button>生成</button>} results={<section aria-label="结果">部分结果</section>} footer={<footer>页脚</footer>} />));
  expect(container.querySelector('img[alt="箱庭物语"]')?.getAttribute('src')).toBe('/scenario-shadow.webp');
  const page = container.querySelector('[data-testid="page-scenario"]')!;
  const card = page.querySelector('.container > .card')!;
  expect(card.querySelector('button')?.textContent).toBe('生成');
  expect(card.querySelector('[aria-label="结果"]')).toBeNull();
  expect(page.querySelector(':scope > footer')?.textContent).toBe('页脚');
  act(() => page.querySelector<HTMLAnchorElement>('a[href="#/encyclopedia/scenario-generator"]')!.click());
  expect(navigate).toHaveBeenCalledWith('/encyclopedia/scenario-generator');
});

it('keeps the title visible with its stream-only explanation and accepts host disabling', () => {
  act(() => root.render(<ScenarioTitleField value="夜雨" onChange={vi.fn()} disabled />));
  expect(container.querySelector('input')?.value).toBe('夜雨');
  expect(container.querySelector('input')?.disabled).toBe(true);
  expect(container.textContent).toContain('用于流式生成时的标题回退');
  expect(container.textContent).toContain('非流式会由 AI 自动命名');
});

it('uses canonical prompt labels for the five controlled answers', () => {
  const change = vi.fn();
  act(() => root.render(<ScenarioQuestionFields answers={{ [SCENARIO_QUESTIONS[0].label]: '雨后的钟楼' }} onChange={change} />));
  const inputs = [...container.querySelectorAll('textarea')];
  expect(inputs).toHaveLength(5);
  expect(inputs[0].value).toBe('雨后的钟楼');
  expect(inputs[0].getAttribute('aria-label')).toBe(SCENARIO_QUESTIONS[0].label);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(inputs[0], '新的钟楼');
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(change).toHaveBeenCalledWith(SCENARIO_QUESTIONS[0].label, '新的钟楼');
});

it('keeps optional-field paths and language callbacks host-controlled', () => {
  const change = vi.fn(); const language = vi.fn();
  act(() => root.render(<><ScenarioBlankFields expanded onToggle={vi.fn()} fields={[]} onChange={change} /><ScenarioLanguageField value="zh-CN" languages={[{ code: 'zh-CN', name: '中文' }, { code: 'en', name: 'English' }]} onChange={language} /></>));
  act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(change).toHaveBeenCalledWith('elements.scene.time');
  const select = container.querySelector('select')!;
  act(() => { select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(language).toHaveBeenCalledWith('en');
});


it('surfaces structured output and the general editor individually without double cards around the result slot', () => {
  act(() => root.render(<ScenarioPageLayout onNavigate={vi.fn()} controls={<button>生成</button>} results={<>
    <p aria-label="推理">推理说明</p>
    <ScenarioResultSurface label="结构化情景结果"><h2>结构化标题</h2><pre>完整 JSON</pre></ScenarioResultSurface>
    <ScenarioResultSurface label="通用情景卡编辑器"><h2>通用卡编辑器</h2><textarea defaultValue="可编辑 Markdown" /></ScenarioResultSurface>
    <a href="/">返回首页</a>
  </>} />));
  const surfaces = [...container.querySelectorAll('[data-testid="scenario-result-surface"]')];
  expect(surfaces).toHaveLength(2);
  expect(container.querySelectorAll('.card')).toHaveLength(3);
  for (const surface of surfaces) {
    expect(surface.className).toBe('card mt-6');
    expect(surface.parentElement?.closest('.card')).toBeNull();
    expect(surface.querySelector('.card')).toBeNull();
  }
  expect(container.querySelector('[aria-label="推理"]')?.closest('.card')).toBeNull();
  expect(container.querySelector('a[href="/"]')?.closest('.card')).toBeNull();
  expect(container.querySelector('textarea')?.value).toBe('可编辑 Markdown');
});
