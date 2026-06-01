import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('pages/battle 继续作为 BattleLitePage + QueryClientProvider 入口', () => {
  const source = readFileSync(join(process.cwd(), 'pages/battle.tsx'), 'utf8');

  expect(source).toContain('QueryClientProvider');
  expect(source).toContain('BattleLitePage');
});
