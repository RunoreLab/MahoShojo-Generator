import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getColorModeInitScript } from '@mahoshojo/ui-web/color-mode-init';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Desktop 的亮暗偏好首屏初始化（D5.0d）。
 *
 * `index.html` 内联的脚本必须与共享源 `getColorModeInitScript()` 逐字一致——
 * 两份文本一旦漂移，Web 与 Desktop 对同一存储键的解析就会分叉，而漂移的方向
 * 恰好最难被肉眼发现。这里不复制脚本逻辑，只钉住「内联 == 生成产物」。
 */
describe('desktop color-mode bootstrap', () => {
  it('inlines the exact shared init script in index.html before any module loads', () => {
    const html = readFileSync(resolve(desktopRoot, 'index.html'), 'utf8');

    expect(html).toContain(getColorModeInitScript());
    // 必须先于模块脚本执行，否则首屏已经按默认主题画过一帧（闪烁）。
    const initIndex = html.indexOf('document.documentElement.dataset.colorMode');
    const moduleIndex = html.indexOf('src="/src/main.tsx"');
    expect(initIndex).toBeGreaterThan(-1);
    expect(moduleIndex).toBeGreaterThan(initIndex);
  });

  it('declares the dark variant on data-color-mode so shared dark: utilities resolve', () => {
    const css = readFileSync(resolve(desktopRoot, 'src/styles/globals.css'), 'utf8');

    expect(css).toContain(
      "@custom-variant dark (&:where([data-color-mode='dark'], [data-color-mode='dark'] *));",
    );
  });
});
