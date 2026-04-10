import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

test('magic-background 装饰层不应拦截 creator 工作台点击事件', () => {
  const css = readFileSync(join(process.cwd(), 'styles/globals.css'), 'utf8');

  expect(css).toMatch(/\.magic-background::before\s*\{[\s\S]*pointer-events:\s*none;/);
});
