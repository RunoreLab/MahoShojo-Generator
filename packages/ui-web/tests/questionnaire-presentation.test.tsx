// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreatorEntryLink, QuestionnaireResultActions } from '../src/details-controls';
import { getQuestionnaireQuestionPresentation } from '../src/questionnaire';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('uses the same creator entry with host navigation and preserves modified-link semantics', () => {
  const onNavigate = vi.fn();
  act(() => root.render(<CreatorEntryLink resolveInternalHref={(href) => `#${href}`} onNavigate={onNavigate} />));
  expect(container.textContent).toBe('想直接创作？ 前往创作工坊');
  const link = container.querySelector('a')!;
  expect(link.getAttribute('href')).toBe('#/creator');
  act(() => link.click()); expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/creator');
  const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
  act(() => link.dispatchEvent(modified));
  expect(modified.defaultPrevented).toBe(false); expect(onNavigate).toHaveBeenCalledTimes(1);
});

it.each(['details', 'canshou'] as const)('shares the %s white save card and leaves export/save actions to the host', (variant) => {
  const save = vi.fn(); const onNavigate = vi.fn();
  act(() => root.render(<QuestionnaireResultActions variant={variant} onNavigate={onNavigate} resolveInternalHref={(href) => `#${href}`} sizeIndicator={<span>UTF-8 体积</span>} status={<p role="status">保存失败，可重试</p>}>
    <button>导出 JSON</button><button onClick={save}>保存到本地卡库</button>
  </QuestionnaireResultActions>));
  expect(container.querySelector('section')?.className).toBe('card');
  expect(container.querySelector('h3')?.textContent).toBe(variant === 'details' ? '保存人物设定' : '后续操作');
  expect(container.querySelector('[role="status"]')?.textContent).toBe('保存失败，可重试');
  act(() => container.querySelectorAll('button')[1]!.click()); expect(save).toHaveBeenCalledOnce();
  act(() => container.querySelector('a')!.click()); expect(onNavigate).toHaveBeenCalledWith('/battle');
});

it.each(['details', 'canshou'] as const)('shares %s final-step, quick-option, length and cooldown copy without opening a closed question', (variant) => {
  const args = { variant, question: { id: 'q', question: '末题', maxLength: 12, allowCustom: false, options: ['选项'] }, answer: '答案', index: 1, total: 2 };
  expect(getQuestionnaireQuestionPresentation(args)).toMatchObject({
    progressLabel: '问题 2 / 2', quickOptions: [], showTextInput: false, limitLabel: '题目上限 12 字',
    nextButtonLabel: variant === 'details' ? '提交' : '生成档案', prevLabel: '返回上题',
  });
  expect(getQuestionnaireQuestionPresentation({ ...args, cooldownSeconds: 3 }).nextButtonLabel).toBe(variant === 'details' ? '请等待 3 秒' : '冷却中 (3s)');
  expect(getQuestionnaireQuestionPresentation({ ...args, question: { ...args.question, options: [] } })).toMatchObject({ quickOptions: [], showTextInput: true });
  expect(getQuestionnaireQuestionPresentation({ ...args, question: { id: 'q', question: '末题' }, answer: '' }).quickOptions).toHaveLength(2);
});
