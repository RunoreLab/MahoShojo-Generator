import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('app/battle 继续作为 BattleLitePage + QueryClientProvider 入口', () => {
  const routeSource = readFileSync(join(process.cwd(), 'app/battle/page.tsx'), 'utf8');
  const providerSource = readFileSync(join(process.cwd(), 'components/competition/BattleRouteProviders.tsx'), 'utf8');
  const queryProviderSource = readFileSync(join(process.cwd(), 'components/competition/QueryRouteProviders.tsx'), 'utf8');

  expect(routeSource).toContain('BattleRouteProviders');
  expect(queryProviderSource).toContain('QueryClientProvider');
  expect(providerSource).toContain('BattleLitePage');
});
