import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

test('battle lite 页面入口声明作用域类并定义专用深色 token', () => {
  const pageSource = read('components/arena-lite/BattleLitePage.tsx');
  const globalsCss = read('styles/globals.css');

  expect(pageSource).toContain('battle-lite-shell');
  expect(globalsCss).toContain('.battle-lite-shell');
  expect(globalsCss).toContain('--battle-lite-panel-bg');
  expect(globalsCss).toContain('--battle-lite-info-bg');
  expect(globalsCss).toContain('--battle-lite-modal-bg');
});

test('battle lite 关键组件不再保留已知高风险浅色硬编码', () => {
  const headerSource = read('components/arena-lite/BattleLiteHeader.tsx');
  const inheritedSource = read('components/arena-lite/BattleLiteInheritedContextNotice.tsx');
  const scenarioSource = read('components/arena-lite/BattleLiteScenarioSection.tsx');
  const aiProviderSource = read('components/AiProviderSelector.tsx');
  const storyOptionsSource = read('components/shared/StoryOptionsPanel.tsx');
  const battleActionsSource = read('components/arena/components/BattleActions.tsx');

  expect(headerSource).not.toContain('bg-white/80');
  expect(headerSource).not.toContain('text-slate-700');
  expect(inheritedSource).not.toContain('bg-sky-50');
  expect(inheritedSource).not.toContain('text-slate-900');
  expect(scenarioSource).not.toContain('bg-white/80');
  expect(aiProviderSource).not.toContain('border-pink-200 bg-white');
  expect(aiProviderSource).not.toContain('bg-pink-50');
  expect(storyOptionsSource).not.toContain('bg-gray-100 text-gray-700');
  expect(battleActionsSource).not.toContain('border-gray-200 bg-white');
});
