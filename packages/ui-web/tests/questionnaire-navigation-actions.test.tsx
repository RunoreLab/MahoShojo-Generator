// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { QuestionnaireNavigationActions } from '../src/questionnaire/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement('div');
document.body.append(container);
const root = createRoot(container);
afterAll(() => { act(() => root.unmount()); container.remove(); });
afterEach(() => act(() => root.render(null)));

test('owns the same prominent action layout without host CSS and never submits an enclosing form', () => {
  const submit = vi.fn();
  const next = vi.fn();
  act(() => root.render(<form onSubmit={submit}><QuestionnaireNavigationActions
    prevLabel="上一题" nextButtonContent="跳过并继续" onPrev={() => {}} onNext={next}
  /></form>));
  const actions = container.querySelector('[role="group"]');
  expect(actions?.getAttribute('aria-label')).toBe('问卷翻页操作');
  expect(actions?.classList.contains('ui-web-questionnaire-navigation')).toBe(true);
  const buttons = container.querySelectorAll('button');
  expect(buttons[0].classList.contains('ui-web-questionnaire-step-button--previous')).toBe(true);
  expect(buttons[1].classList.contains('ui-web-questionnaire-step-button')).toBe(true);
  expect(buttons[1].type).toBe('button');
  act(() => buttons[1].click());
  expect(next).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

test('keeps required, busy and final labels and disabled callbacks controlled by the host', () => {
  const prev = vi.fn(); const next = vi.fn();
  act(() => root.render(<QuestionnaireNavigationActions prevLabel="上一题" nextButtonContent="下一题"
    disablePrev disableNext onPrev={prev} onNext={next} />));
  const buttons = container.querySelectorAll('button');
  act(() => { buttons[0].click(); buttons[1].click(); });
  expect(prev).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('跳过');
  act(() => root.render(<QuestionnaireNavigationActions prevLabel="上一题" nextButtonContent="跳过并生成"
    onPrev={prev} onNext={next} />));
  act(() => container.querySelectorAll('button')[1].click());
  expect(next).toHaveBeenCalledOnce();
});

test('keeps enabled controls focusable and honors a disabled host fieldset', () => {
  const next = vi.fn();
  act(() => root.render(<QuestionnaireNavigationActions prevLabel="上一题" nextButtonContent="生成"
    onPrev={() => {}} onNext={next} />));
  const button = container.querySelectorAll('button')[1];
  button.focus();
  expect(document.activeElement).toBe(button);
  act(() => root.render(<fieldset disabled><QuestionnaireNavigationActions prevLabel="上一题" nextButtonContent="生成"
    onPrev={() => {}} onNext={next} /></fieldset>));
  act(() => container.querySelectorAll('button')[1].click());
  expect(next).not.toHaveBeenCalled();
});
