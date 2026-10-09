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

it('uses the Web section order, compact local hint, and controlled Markdown workspace', async () => {
  const { ScenarioFormSections, ScenarioDraftNotice, GeneralScenarioEditor } = await import('../src/scenario');
  const clear = vi.fn(); const edit = vi.fn(); const create = vi.fn(); const convert = vi.fn();
  act(() => root.render(<>
    <ScenarioFormSections inputs={<ScenarioDraftNotice storageLabel="本机" onClear={clear} />} advanced="高级字段" provider="供应商" language="语言" mode="方式" actions="生成" tokens="Tokens" />
    <GeneralScenarioEditor draft={{ templateId: '通用情景', title: '钟楼', content: '# 雨夜', extra: { retained: true } }} onCreate={create} onConvert={convert} canConvert onChange={edit} />
  </>));
  const text = container.textContent!;
  for (const [before, after] of [['高级字段', '供应商'], ['供应商', '语言'], ['语言', '方式'], ['方式', '生成'], ['生成', 'Tokens']]) expect(text.indexOf(before)).toBeLessThan(text.indexOf(after));
  expect(text).toContain('当前输入会自动保存到本机');
  expect(text).not.toContain('浏览器');
  expect(text).not.toContain('恢复草稿');
  const byText = (label: string) => [...container.querySelectorAll('button')].find((button) => button.textContent === label)!;
  act(() => { byText('清空本地草稿').click(); byText('创建空白通用情景卡').click(); byText('将生成结果转为通用情景卡').click(); });
  expect(clear).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce(); expect(convert).toHaveBeenCalledOnce();
  const input = container.querySelector<HTMLInputElement>('#general-scenario-title')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新标题'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(edit).toHaveBeenCalledWith({ title: '新标题' });
  expect(container.querySelector('details')?.open).toBe(false);
  expect(container.querySelector('pre')?.textContent).toContain('"retained": true');
});

it('does not claim an old save time or successful autosave after storage fails', async () => {
  const { ScenarioDraftNotice } = await import('../src/scenario');
  act(() => root.render(<ScenarioDraftNotice storageLabel="本机" updatedAt={1000} saveUnavailable onClear={vi.fn()} />));
  expect(container.textContent).toContain('自动保存暂不可用');
  expect(container.textContent).not.toContain('已自动保存于');
  expect(container.textContent).not.toContain('当前输入会自动保存');
});
