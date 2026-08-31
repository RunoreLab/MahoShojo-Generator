import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const arenaPageSource = readFileSync(
  path.resolve(import.meta.dirname, '../components/arena/ArenaPage.tsx'),
  'utf8',
);

describe('Arena 保存图片窗口结构', () => {
  it('使用共享 ArenaRoomDialog，而不是无键盘语义的自制 fixed overlay', () => {
    expect(arenaPageSource).toContain('import { ArenaRoomDialog }');
    expect(arenaPageSource).toContain('title="保存战报图片"');
    expect(arenaPageSource).toContain('aria-label="战报图片"');
    expect(arenaPageSource).not.toContain('className="fixed inset-0 bg-black flex items-center justify-center z-50"');
  });
});
