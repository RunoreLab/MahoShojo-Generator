import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const arenaPageSource = readFileSync(
  path.resolve(import.meta.dirname, '../components/arena/ArenaPage.tsx'),
  'utf8',
);

/**
 * 这里只守一条性质：**保存战报图片走共享的 `ArenaRoomDialog`，而不是页面内自制的 overlay。**
 *
 * 原本还有三条断言，本轮删掉，因为它们都不是性质：
 *
 * - `title="保存战报图片"` 与 `aria-label="战报图片"` 钉的是两句**文案**。改一个字就变红，
 *   而可访问性有没有做对跟文案是哪一个词无关；真正要守的对话���语义在
 *   `tests/modal-accessibility.test.tsx` 那一族里（`BaseModal` / `DataCardReportModal` /
 *   `BattleDataModal` 的 labelled + focus trap + Escape + 焦点归还）。
 * - `not.toContain('className="fixed inset-0 bg-black flex items-center justify-center z-50"')`
 *   是对一个**特定反模式的 grep**：有人真要手写 overlay，只要类名顺序不同或改用 `cn()`，
 *   这条断言照样绿。它挡不住任何东西，只会在重构时误报。
 */
describe('Arena 保存图片窗口结构', () => {
  it('使用共享 ArenaRoomDialog，而不是无键盘语义的自制 fixed overlay', () => {
    expect(arenaPageSource).toContain('import { ArenaRoomDialog }');
  });
});