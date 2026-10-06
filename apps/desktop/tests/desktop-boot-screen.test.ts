import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 启动首帧（D5.2）的结构门禁。
 *
 * WebView 首绘前的空白由两层兜住：native 窗口 `backgroundColor` 覆盖
 * WebView 尚未初始化的窗口期；`index.html` 内联的品牌画面覆盖 HTML 已解析、
 * React bundle 未就绪的窗口期。两层都不发网络请求、不引入第二个 webview。
 * 这组断言钉住「首帧真的存在且按已解析主题着色」——退化成空 #root 或纯
 * 白底时，回归会回到用户最先抱怨的白屏。
 */
describe('desktop branded first paint', () => {
  it('pre-renders the boot mark inside #root before the module script', () => {
    const html = readFileSync(resolve(desktopRoot, 'index.html'), 'utf8');

    const rootIndex = html.indexOf('<div id="root">');
    const bootIndex = html.indexOf('desktop-boot', rootIndex);
    const moduleIndex = html.indexOf('src="/src/main.tsx"');
    expect(rootIndex).toBeGreaterThan(-1);
    expect(bootIndex).toBeGreaterThan(rootIndex);
    // 首帧必须先于 bundle：脚本执行后 React 会接管并清空这些节点。
    expect(moduleIndex).toBeGreaterThan(bootIndex);
    expect(html).toContain('src="/favicon.svg"');
  });

  it('colors the boot screen from the resolved color mode instead of a fixed white', () => {
    const html = readFileSync(resolve(desktopRoot, 'index.html'), 'utf8');

    // 亮/暗两版都镜像 --app-magic-bg-white 的渐变字面量；暗色分支必须挂在
    // init 脚本写入的 data-color-mode 上，与产品主题同一裁决源。
    expect(html).toContain("html[data-color-mode='dark'] .desktop-boot");
    expect(html).toContain('#fecfef');
    expect(html).toContain('#0b1220');
  });

  it('sets a non-white native window background for the pre-webview gap', () => {
    const config = JSON.parse(
      readFileSync(resolve(desktopRoot, 'src-tauri/tauri.conf.json'), 'utf8'),
    ) as { app?: { windows?: Array<{ label?: string; backgroundColor?: string }> } };
    const mainWindow = config.app?.windows?.find((w) => w.label === 'main-ui');

    expect(mainWindow?.backgroundColor).toBe('#0b1220');
  });
});
