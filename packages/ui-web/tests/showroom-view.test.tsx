// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShowroomView } from '../src/showroom';
import { SHOWROOM_MAGICAL_GIRL } from '../src/showroom/fixtures';
import { SHOWROOM_SECTIONS } from '../src/showroom/sections';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('renders every registered section, the real result card, and a working modal sample', () => {
  act(() => root.render(<ShowroomView />));

  for (const section of SHOWROOM_SECTIONS) {
    expect(container.querySelector(`#showroom-${section.id}`), `缺 ${section.id} 分区`).not.toBeNull();
  }
  // 结果卡分区渲染的是真实 MagicalGirlCard（.result-card 来自 product-shell.css）。
  expect(container.querySelector('#showroom-result-surfaces .result-card')).not.toBeNull();
  const results = container.querySelector('#showroom-result-surfaces')!;
  expect(results.querySelector('[data-testid="local-images-panel"]')).not.toBeNull();
  expect(results.textContent).toContain('独立保存在这台设备上的原图');
  expect(results.textContent).toContain('模型：showroom-example-model');
  expect(results.textContent).toContain('输入 120｜推理 30｜输出 60');
  expect(results.querySelector('img[src="/arena-white.svg"]')).not.toBeNull();
  expect(results.querySelector('[data-testid="arena-web-result"] pre')?.textContent).toBe('<main>样板间战报</main>');
  expect(results.querySelector('[data-testid="arena-web-result"] main, iframe')).toBeNull();
  // 页脚分区渲染真实 ProductFooter。
  expect(container.querySelector('#showroom-footer footer, #showroom-footer .footer')).not.toBeNull();

  const openButton = [...container.querySelectorAll('button')]
    .find((button) => button.textContent === '打开示例对话框');
  expect(openButton).toBeDefined();
  act(() => { openButton!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it('模型选择器样板在模拟生成更新时保留长菜单与活动项', () => {
  vi.useFakeTimers();
  try {
    act(() => root.render(<ShowroomView />));
    const sample = container.querySelector('[aria-label="模型选择器滚动样板"]')!;
    const update = sample.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    act(() => update.click());
    const trigger = sample.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    act(() => trigger.click());
    const active = trigger.getAttribute('aria-activedescendant');
    expect(sample.querySelectorAll('[role="option"]')).toHaveLength(16);
    act(() => vi.advanceTimersByTime(1500));
    expect(update.textContent).toContain('停止模拟更新（3）');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(active);
    act(() => update.click());
  } finally {
    vi.useRealTimers();
  }
});

it('renders production image feedback with explicit stop/resume, unknown submission and a seed-zero result', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('[aria-label="图片生成任务与结果样板"]')!;
  expect(sample.querySelectorAll('progress')).toHaveLength(2);
  expect([...sample.querySelectorAll('progress')].map(node => node.getAttribute('value'))).toEqual(['35', null]);
  expect(sample.textContent).toContain('勿立即重复生成');
  expect(sample.textContent).toContain('种子值: 0');
  expect(sample.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  const button = (text: string) => [...sample.querySelectorAll('button')].find(node => node.textContent === text)!;
  act(() => button('停止等待（已提交的任务可能仍会计费）').click());
  expect(sample.textContent).toContain('任务 ID：showroom-existing-image-task');
  expect(sample.querySelectorAll('progress')).toHaveLength(1);
  act(() => button('继续查询原任务').click());
  expect(sample.querySelectorAll('progress')).toHaveLength(2);
});

it('keeps host generation copy inside the same mode-aware notice as the default copy', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('[aria-label="生成方式说明样板"]')!;
  const hostCopy = [...sample.querySelectorAll('p')].find(node => node.textContent?.startsWith('连接中断时'))!;
  const defaultCopy = [...sample.querySelectorAll('p')].find(node => node.textContent?.startsWith('你已选择'))!;
  expect(hostCopy.parentElement?.className).toBe(defaultCopy.parentElement?.className);
  expect(hostCopy.parentElement?.classList.contains('text-sm')).toBe(true);
  const stream = [...sample.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(node => node.textContent === '流式')!;
  act(() => stream.click());
  expect(hostCopy.parentElement?.classList.contains('bg-yellow-50')).toBe(true);
  expect(hostCopy.textContent).toContain('停止任务需要服务器确认');
  expect(sample.textContent).toContain('你已选择【流式生成');
});

it('renders production full and lite Arena frames with result cards in their real slots', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('[aria-label="竞技场结果布局样板"]')!;
  expect(sample.querySelector('.arena-page-shell > .card')).not.toBeNull();
  expect(sample.querySelector('.battle-lite-shell .card')).not.toBeNull();
});

it('uses the shared Web display selector and immersive toolbar without interpreting generated content', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('[aria-label="Web 战报显示与沉浸工具栏样板"]')!;
  const button = (label: string) => [...sample.querySelectorAll('button')].find(node => node.textContent === label)!;
  const input = sample.querySelector<HTMLInputElement>('[aria-label="沉浸切换保留内容"]')!;
  input.value = '样板交互保留';
  act(() => button('沉浸体验').click());
  expect(sample.querySelector('[data-testid="arena-web-immersive"]')).not.toBeNull();
  expect(sample.querySelector('input')).toBe(input);
  act(() => button('退出沉浸').click());
  expect(input.value).toBe('样板交互保留');
  act(() => button('普通显示').click());
  expect(sample.querySelector('[data-testid="arena-web-header"]')).toBeNull();
  expect(sample.querySelector('.result-card')?.textContent).toContain('同一战报的普通卡片样板');
  act(() => button('Web 显示').click());
  expect(sample.querySelector('[data-testid="arena-web-header"]')).not.toBeNull();
  expect(sample.querySelector('iframe,script')).toBeNull();
});

it('uses production story error views with multiline copy, an explicit read action and the real branch modal', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('[aria-label="故事读取错误样板"]')!;
  expect(sample.querySelectorAll('.error-message[role=alert]')).toHaveLength(2);
  expect(sample.querySelector('[data-story-read-status=error] .whitespace-pre-wrap')?.textContent).toContain('\n');
  const button = (label: string) => [...sample.querySelectorAll('button')].find(node => node.textContent === label)!;
  act(() => button('模拟重读本章').click());
  expect(sample.querySelector('[data-story-read-status=loaded]')?.textContent).toContain('已读取示例正文');
  expect(sample.querySelector('[data-story-read-status=loaded] [role=alert]')).toBeNull();
  act(() => button('重置章节错误样板').click());
  expect(sample.querySelector('[data-story-read-status=error] .error-message')).not.toBeNull();
  act(() => button('打开分支读取错误样板').click());
  expect(document.querySelector('[role=dialog] .error-message[role=alert] .whitespace-pre-wrap')?.textContent).toBe('示例：分支来源读取失败\n原故事仍保留。');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭对话框');
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role=dialog]')).toBeNull();
});

it('shows the shared red and blue error surfaces with inherited, focusable help links', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('[aria-label="错误文字对比样板"]')!;
  expect(sample.querySelectorAll('.error-message[role=alert]')).toHaveLength(2);
  expect(sample.querySelectorAll('.blue-theme .error-message')).toHaveLength(1);
  const links = sample.querySelectorAll<HTMLAnchorElement>('.error-message .opacity-95 a');
  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link.getAttribute('href')).toBe('#showroom-result-surfaces');
    expect(link.classList.contains('hover:opacity-100')).toBe(true);
    expect(link.tabIndex).toBe(0); link.focus(); expect(document.activeElement).toBe(link);
  }
});

it('shows both production Arena appearances and tones with multiline copy and focusable host help', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('[aria-label="竞技场操作反馈样板"]')!;
  for (const appearance of ['full', 'lite']) {
    for (const tone of ['error', 'warning']) {
      const alert = sample.querySelector(`.arena-feedback--${appearance}.arena-feedback--${tone}`)!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.classList.contains('error-message')).toBe(false);
      expect(alert.querySelector('.whitespace-pre-wrap')?.textContent).toContain('\n');
      expect(!!alert.closest('.battle-lite-shell')).toBe(appearance === 'lite');
      const link = alert.querySelector<HTMLAnchorElement>('a')!;
      expect(link.getAttribute('href')).toBe('#showroom-result-surfaces');
      link.focus(); expect(document.activeElement).toBe(link);
    }
  }
});

it('uses the real forge theme editor for preset and custom color states', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('#showroom-forms [aria-label="卡牌工坊主题色样板"]')!;
  expect(sample).not.toBeNull();
  const presets = () => [...sample.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
  expect(presets()).toHaveLength(8);
  expect(presets().filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.getAttribute('aria-label'))).toEqual(['主题色 #ff6b9d']);
  const blue = sample.querySelector<HTMLButtonElement>('button[aria-label="主题色 #3b82f6"]')!;
  blue.focus(); expect(document.activeElement).toBe(blue);
  act(() => blue.click());
  expect(blue.getAttribute('aria-pressed')).toBe('true');
  const custom = sample.querySelector<HTMLInputElement>('input[aria-label="自定义主题色"]')!;
  expect(custom.value).toBe('#3b82f6');
  expect(custom.closest('label')?.classList).toContain('focus-within:outline-(--app-accent-strong)');
  custom.focus(); expect(document.activeElement).toBe(custom);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(custom, '#123456');
    custom.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(presets().every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
});


it('uses production width controls with independent disabled groups and a live real report preview', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('[aria-label="战报卡片宽度样板"]')!;
  const groups = sample.querySelectorAll('fieldset'); expect(groups).toHaveLength(2);
  const card = container.querySelector<HTMLElement>('#showroom-result-surfaces .result-card.relative')!;
  expect(card.style.maxWidth).toBe('760px');
  const auto = groups[0].querySelector<HTMLInputElement>('input[type=radio]')!;
  act(() => auto.click()); expect(card.style.maxWidth).toBe('100%');
  for (const input of groups[1].querySelectorAll<HTMLInputElement>('input')) expect(input.disabled).toBe(true);
});

it('copies the complete fixture through the production result button only after an explicit click', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { userAgent: navigator.userAgent, clipboard: { writeText } });
  try {
    act(() => root.render(<ShowroomView />));
    const sample = container.querySelector('[aria-label="完整结果 JSON 复制样板"]')!;
    const button = sample.querySelector('button')!;
    expect(button.textContent).toBe('复制到剪贴板');
    expect(button.classList.contains('ui-web-generation-action--secondary')).toBe(true);
    expect(sample.querySelector('[role=status]')).toBeNull(); expect(writeText).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(SHOWROOM_MAGICAL_GIRL, null, 2));
    expect(sample.querySelector('[role=status]')?.textContent).toBe('完整结果 JSON 已复制到剪贴板');
  } finally { vi.unstubAllGlobals(); }
});

it('renders the production questionnaire navigation with required and busy states', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('[aria-label="问卷翻页操作样板"]')!;
  const actions = sample.querySelector('.ui-web-questionnaire-navigation')!;
  const [prev, next] = [...actions.querySelectorAll('button')];
  expect(prev.disabled).toBe(true);
  expect(next.disabled).toBe(false);
  act(() => next.click());
  expect(sample.querySelector('[role="status"]')?.textContent).toContain('问题 2 / 2');
  expect(next.disabled).toBe(true);
  const input = sample.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '示例回答');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(next.disabled).toBe(false);
  act(() => sample.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(prev.disabled).toBe(true); expect(next.disabled).toBe(true);
  expect(next.textContent).toBe('提交中...');
  expect(sample.querySelectorAll('.blue-theme .ui-web-questionnaire-step-button:disabled')).toHaveLength(2);
});

it('renders the production NovelAI controlled fields with custom values and disabled state', () => {
  act(() => root.render(<ShowroomView />));
  const sample = container.querySelector('[aria-label="NovelAI 受控设置样板"]')!;
  const fieldset = sample.querySelector('fieldset')!;
  expect(sample.textContent).toContain('简单模式');
  expect(fieldset.querySelector('input[type=number]')).toBeNull();
  act(() => fieldset.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  expect(fieldset.querySelector('input[type=number]')).not.toBeNull();
  const toggle = [...fieldset.querySelectorAll('button')].find(node => node.textContent?.includes('LLM 优化提示词'))!;
  act(() => toggle.click());
  expect(fieldset.textContent).toContain('此样板不读取配置、不发送请求');
  act(() => sample.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  expect(fieldset.disabled).toBe(true);
});
