import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getMotionPreferenceInitScript } from '@mahoshojo/ui-web/device-preferences-init';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Desktop 的减少动效偏好首屏初始化（D5.1-S1 / DESK-SET-007）。
 *
 * 与 `color-mode-init.test.ts` 同一钉法：`index.html` 内联脚本必须与共享源
 * `getMotionPreferenceInitScript()` 逐字一致——两份文本一旦漂移，Web 与
 * Desktop 对同一存储键/`data-motion` 标记的解析就会分叉。
 */
describe('desktop motion-preference bootstrap', () => {
  it('inlines the exact shared init script in index.html before any module loads', () => {
    const html = readFileSync(resolve(desktopRoot, 'index.html'), 'utf8');

    expect(html).toContain(getMotionPreferenceInitScript());
    // 必须先于模块脚本执行，否则首屏已按系统动效画过一帧（闪烁）。
    const initIndex = html.indexOf('document.documentElement.dataset.motion');
    const moduleIndex = html.indexOf('src="/src/main.tsx"');
    expect(initIndex).toBeGreaterThan(-1);
    expect(moduleIndex).toBeGreaterThan(initIndex);
  });
});
