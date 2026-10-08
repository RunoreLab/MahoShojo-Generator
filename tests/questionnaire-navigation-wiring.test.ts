import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test.each([
  '../apps/web/components/creation/DetailsPage.tsx',
  '../apps/web/components/creation/CanshouPage.tsx',
  '../apps/desktop/src/app/details-page.tsx',
  '../apps/desktop/src/app/canshou-page.tsx',
])('%s consumes the shared navigation without host style overrides', (path) => {
  const source = read(path);
  expect(source).toContain('QuestionnaireQuestionPanel');
  expect(source).not.toMatch(/(?:prevButtonClass|nextButtonClass)=/);
});

test('shared stylesheet owns the Web-sized actions, focus, blue theme and reduced-motion fallback', () => {
  const css = read('../packages/ui-web/src/styles.css');
  expect(css).toMatch(/\.ui-web-questionnaire-navigation\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 3fr\)/);
  expect(css).toMatch(/\.ui-web-questionnaire-step-button\s*\{[^}]*min-height: 48px/);
  expect(css).toContain('.ui-web-questionnaire-step-button:focus-visible');
  expect(css).toContain('.blue-theme .ui-web-questionnaire-step-button');
  expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  expect(css).toContain(":root[data-motion='reduce'] .ui-web-questionnaire-step-button");
});
