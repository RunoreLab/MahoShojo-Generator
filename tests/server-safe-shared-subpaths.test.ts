/**
 * 面向 Server Component 的共源入口必须保持 RSC 安全。
 *
 * ## 这条测试守的是什么
 *
 * Next 的 App Router 有一条 jsdom 测试抓不到的边界：**Server Component 的导入链上不能出现 React
 * hook**。`apps/web/app/encyclopedia/[slug]/page.tsx` 是 Server Component（`generateStaticParams` 与
 * `generateMetadata` 都要读目录数据），它一旦经过的模块里有 `useState` / `useEffect`，`next build`
 * 会直接失败：
 *
 * > You're importing a component that needs `useState`. This React Hook only works in a
 * > Client Component.
 *
 * 症状看起来完全无害——`next build` 之外的一切都绿，`apps/web` 的 429 个测试文件全部通过——
 * 因此它只在 `pnpm run workspace:build` 时才出现。把这条边界写成静态断言，可以让失败发生在
 * 仓库根测试里，并给出可读的诊断，而不是一句 Next 的 hook 报错。
 *
 * ## 为什么在仓库根而不是 `packages/ui-web/tests`
 *
 * 它读 `packages/ui-web` 的源码与 manifest，因此验的是**仓库**的性质而不是某个包的性质。放进包里会
 * 让 `ui-web` 的测试去读文件系统，而那正是 `MONO-005-SHARED-UI-RUNTIME` 立刻命中它自己的原因——
 * 共享客户端包不得导入 Node builtin。跨包集成测试在本仓库有固定位置：根 `tests/`。
 *
 * ## 为什么用静态扫描而不是渲染断言
 *
 * RSC 边界是**构建期**的模块图性质，不是运行时性质：在一个 jsdom 测试里渲染这些函数完全可以正常工作，
 * 因为它们本来就不是组件。唯一能证明"这条导入链干净"的方式是读源码。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', 'packages', 'ui-web');
const SRC = path.join(PACKAGE_ROOT, 'src');

/**
 * 会被 Server Component 导入的共源入口。
 *
 * 判据是**实际有 RSC 消费者**：
 *
 * - `./navigation` 被 TopBar 覆盖率逻辑在服务端读；
 * - `./capability` 是纯数据，被两端注入能力快照；
 * - `./encyclopedia` 被百科路由的 `generateStaticParams` / `generateMetadata` 读；
 * - `./encyclopedia-frame` 被 `app/encyclopedia/page.tsx` 的 Suspense fallback 读——
 *   frame 本体零 hook，但 `encyclopedia-views` 桶出口挂着 hook，RSC 只能走这条叶子入口；
 * - `./markdown-text` 被 `app/api/media-proxy/route.ts` 经由 `lib/markdown/externalMedia.ts` 读；
 * - `./home` 被 `app/page.tsx` 读功能目录与 preload 列表；
 * - `./color-mode-init` 被 `app/layout.tsx` 读首屏防闪烁脚本——它必须是零 hook 的纯数据模块。
 * - `./card-library-visibility` 被 `lib/data-card-visibility.ts` 经 `app/api/data-cards` 读——
 *   纯数据可见性归一化，不得经由含客户端组件的 `./card-library` 桶出口。
 * - `./device-preferences-init` 被 `app/layout.tsx` 读首屏 motion 偏好防闪烁脚本——与
 *   `color-mode-init` 同一先例：RSC 与 Desktop `index.html` 内联消费的只能是零 hook
 *   纯数据模块，偏好 hook 在同目录的 `./device-preferences`（DESK-SET-007）。
 *
 * `./local-archive` 与 `./local-cards` 的控制器是客户端状态机，`./markdown` 与 `./encyclopedia-views` 与
 * `./shell` 只在 Client Component 里用，因此不在此列。
 *
 * 往这个列表里加一个入口之前，先确认它真的会被服务端代码导入——把一个纯客户端模块误列为
 * "RSC 安全"会让人以为它可以在 Server Component 里用。
 */
const SERVER_SAFE_ENTRYPOINTS: Readonly<Record<string, string>> = {
  './navigation': 'navigation.ts',
  './capability': 'capability/index.ts',
  './encyclopedia': 'encyclopedia/index.ts',
  './encyclopedia-frame': 'encyclopedia/views/EncyclopediaPageFrame.tsx',
  './markdown-text': 'markdown/text/index.ts',
  './home': 'home/index.ts',
  './color-mode-init': 'color-mode/init.ts',
  './device-preferences-init': 'device-preferences/init.ts',
  './card-library-visibility': 'card-library/visibility.ts',
  // Web /creator metadata 经由 lib/creator/page-copy 读取的纯文案叶子。
  './creator-copy': 'creator/page-copy.ts',
};

/**
 * React hook 的调用形态。
 *
 * 只匹配 `useXxx(` 的调用而不是标识符出现：`useState` 作为类型或属性名出现是无害的，而调用才是
 * Next 会拒绝的那件事。
 */
const HOOK_CALL = /\buse[A-Z][A-Za-z0-9]*\s*\(/;

/**
 * 去掉注释后再找 hook 调用。
 *
 * 注释里提到 hook 名字是必要的——这些模块的说明文字经常要解释"为什么这里用 hook"或"为什么这里
 * 不能用 hook"，而 `HomeView.tsx` 的模块注释就写着 Web 的 `HomePage` 还挂着 `useAuth()`。不做
 * 剥离的话门禁会被自己的文档触发，而那等于没有门禁。
 *
 * 块注释用等量换行替换而不是删空，为的是保住行号——报错时要能直接跳到那一行。
 */
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

const findHookCalls = (source: string): { line: number; text: string }[] => {
  const lines = source.split('\n');
  const code = stripComments(source).split('\n');
  const found: { line: number; text: string }[] = [];
  code.forEach((line, index) => {
    if (HOOK_CALL.test(line)) found.push({ line: index + 1, text: lines[index]?.trim() ?? line.trim() });
  });
  return found;
};

/** 解析 `./x` 形式的相对导入，跳过类型导入与纯类型说明。 */
const resolveRelative = (fromFile: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (candidate.endsWith('.ts') || candidate.endsWith('.tsx')) {
      try {
        readFileSync(candidate, 'utf8');
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
};

const collectModuleGraph = (entryFile: string): string[] => {
  const seen = new Set<string>();
  const queue = [entryFile];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^import\s+(?:type\s+)?[^'"]*from\s+'([^']+)'/gm)) {
      const resolved = resolveRelative(file, match[1]);
      if (resolved) queue.push(resolved);
    }
    // `export … from '…'` 同样是导入链的一部分：Server Component 经由入口的 re-export 一样会踩到 hook。
    for (const match of source.matchAll(/^export\s+(?:type\s+)?[^'"]*from\s+'([^']+)'/gm)) {
      const resolved = resolveRelative(file, match[1]);
      if (resolved) queue.push(resolved);
    }
  }

  return [...seen];
};

describe('server-safe shared entrypoints stay free of React hooks', () => {
  for (const [subpath, relativeFile] of Object.entries(SERVER_SAFE_ENTRYPOINTS)) {
    it(`${subpath} imports no React hook`, () => {
      const entryFile = path.join(SRC, relativeFile);
      const graph = collectModuleGraph(entryFile);
      expect(graph.length).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const file of graph) {
        const offenders_ = findHookCalls(readFileSync(file, 'utf8'));
        for (const offender of offenders_) {
          offenders.push(`${path.relative(SRC, file)}:${offender.line} ${offender.text}`);
        }
      }

      expect(
        offenders,
        `${subpath} 被 Server Component 导入，因此它的模块图上不能有 React hook 调用：\n${offenders.join('\n')}` +
          '\n把这些 hook 搬进客户端专属的 subpath（例如 ./encyclopedia-views），纯数据留在原处。',
      ).toEqual([]);
    });
  }

  it('keeps the actual Web Creator metadata adapter free of client hook imports', async () => {
    const bundled = await build({
      entryPoints: [path.resolve(PACKAGE_ROOT, '../../apps/web/lib/creator/page-copy.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    expect(Object.keys(bundled.metafile!.inputs).some((file) => file.endsWith('src/creator/page-copy.ts'))).toBe(true);
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
  });

  it('lists every shared entrypoint so a new one is a deliberate decision', () => {
    // 新增 subpath 时如果忘了判断它是否 RSC 安全，这条会提醒你。刻意不在这里自动推断——推断需要
    // 知道 RSC 消费者，而那是仓库里另一处的事实。
    const pkg = JSON.parse(
      readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };

    const unlisted = Object.keys(pkg.exports).filter(
      (subpath) => !subpath.endsWith('.css') && !(subpath in SERVER_SAFE_ENTRYPOINTS),
    );

    // 未列出的入口目前都是客户端专属或视图入口；如果哪天某个 Server Component 开始 import 它们，
    // 这条断言会先提醒把它登记进来并验证。问卷与角色结果入口分别由客户端交互面板和结果卡使用，
    // 本地数据卡列表只在客户端读设备存储，字段编辑器只在客户端编辑页使用，AI Provider 选择器是
    // 带 hook 的客户端状态机，因此保持在这里作为显式的客户端专属登记。
    // `./color-mode` 承载 `useColorModePreference` 与 DOM 应用逻辑，是刻意的客户端入口；
    // RSC 只消费同目录的 `./color-mode-init`。
    // `./card-library` 是 D5.0e 抽出的卡库模态框与客户端状态机，`./modal` 是客户端弹窗
    // 基件；两者都只在 Client Component/宿主适配层消费，不进入 Server Component 导入链。
    // `./client`、`./details-controls`、`./character-card` 是 D5.1a 下沉的 details 页
    // 交互/结果区段，均为客户端专用。
    // `./community` 是 D5.1-P1 迁入的纯数据（QQ 群列表），消费方是页脚、公告与竞技场社群区
    // 等客户端组件；它本身零 hook，但目前没有 RSC 消费者，按「无 RSC 消费者不登记为
    // server-safe」的规则留在客户端专属列。`./announcement` 同为 D5.1-P1 新增：公告中心是
    // 带轮询的客户端状态机，只在客户端挂载。
    // `./character-manager`、`./media` 是 D5.1-P2-r5 上移的角色管理页骨架与主题图组件，
    // `./messages` 是 d-1b 上移的消息呈现层：三者的消费方都隔着 'use client' 边界
    // （MessagesPage、ThemeImage、CharacterManagerPage），不进入 Server Component 导入链。
    // `./settings` 与 `./device-preferences` 是 d5.1-s1 的设置页与设备偏好客户端状态机：
    // `app/settings/page.tsx` 只经 `'use client'` 的 SettingsRouteProviders 挂载它们，
    // RSC 消费的仅是同目录的 `./device-preferences-init`（已登记在 server-safe 列）。
    expect(unlisted.sort()).toEqual([
      './ai-provider',
      './announcement',
      './card-editor',
      './card-library',
      './character-card',
      './character-manager',
      './character-result',
      './client',
      './color-mode',
      './community',
      './creator',
      './details-controls',
      './device-preferences',
      './encyclopedia-views',
      './free',
      './local-archive',
      './local-cards',
      './markdown',
      './media',
      './messages',
      './modal',
      './questionnaire',
      './scenario',
      './settings',
      './shell',
    ]);
  });
});
