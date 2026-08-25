import { expect, test, vi } from 'vitest';

import { adaptRuntimeD1ClientForNodeDataPorts } from '@/lib/db/node-data-port-adapter';

test('OpenNext D1 adapter 不把 HTTP retry options 传入 binding statement', async () => {
  const run = vi.fn(async () => ({ success: true, results: [] }));
  const all = vi.fn(async () => ({ success: true, results: [{ id: 'card-1' }] }));
  const bind = vi.fn(function bindRuntimeStatement() {
    return { bind, run, all };
  });
  const prepare = vi.fn(() => ({ bind, run, all }));
  const client = adaptRuntimeD1ClientForNodeDataPorts({ prepare });
  const statement = client.prepare('SELECT 1').bind('card-1');

  await statement.run({ retry: 'none' });
  await statement.all({ retry: 'safe-read' });

  expect(prepare).toHaveBeenCalledWith('SELECT 1');
  expect(bind).toHaveBeenCalledWith('card-1');
  expect(run).toHaveBeenCalledWith();
  expect(all).toHaveBeenCalledWith();
});
