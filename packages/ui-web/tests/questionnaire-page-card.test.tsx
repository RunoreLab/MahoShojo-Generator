// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { QuestionnairePageCard } from '../src/details-controls/index';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => act(() => root.unmount()));

test('details keeps its accessible heading and brand above changing host content', () => {
  act(() => root.render(
    <QuestionnairePageCard variant="details" className="flex flex-col gap-5">
      <section aria-label="介绍">问卷介绍</section>
    </QuestionnairePageCard>,
  ));
  const logo = container.querySelector('img[alt="Questionnaire Logo"]');
  expect(logo?.getAttribute('src')).toBe('/questionnaire-logo.svg');
  expect(container.querySelector('h1')?.textContent).toBe('魔法少女问卷生成');
  expect(container.querySelector('h1')?.className).toBe('sr-only');
  expect(container.firstElementChild?.className).toBe('card flex flex-col gap-5');

  act(() => root.render(
    <QuestionnairePageCard variant="details" className="flex flex-col gap-5">
      <textarea aria-label="角色设定" disabled defaultValue="已恢复回答" />
    </QuestionnairePageCard>,
  ));
  expect(container.querySelector('img[alt="Questionnaire Logo"]')).toBe(logo);
  expect(container.querySelector('textarea')?.value).toBe('已恢复回答');
  expect(container.querySelector('textarea')?.disabled).toBe(true);
});

test('canshou keeps both theme assets and updates the primary questionnaire description', () => {
  const render = (description?: string) => act(() => root.render(
    <QuestionnairePageCard variant="canshou" description={description}>
      <button disabled>开始调查</button>
    </QuestionnairePageCard>,
  ));
  render('前进吧，残兽！');
  expect(container.querySelector('.theme-image-light')?.getAttribute('src')).toBe('/beast-logo.svg');
  expect(container.querySelector('.theme-image-dark')?.getAttribute('src')).toBe('/beast-logo-white.svg');
  expect(container.querySelector('h1')?.textContent).toBe('残兽问卷生成');
  expect(container.querySelector('header p')?.textContent).toBe('前进吧，残兽！');
  expect(container.querySelector('button')?.disabled).toBe(true);
  render('恢复后的问卷说明');
  expect(container.querySelector('header p')?.textContent).toBe('恢复后的问卷说明');
  render();
  expect(container.querySelector('header p')).toBeNull();
  expect(container.querySelectorAll('img[alt="残兽调查"]')).toHaveLength(2);
});
