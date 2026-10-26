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
  // 保留已公开的 Tavern 服务端安全叶子契约；茶会现在直接复用纯 domain worldbook。
  // DOM 栅格化只在调用时使用，Node 调用返回占位 PNG；不得经由含 hook 的 Tavern barrel。
  './tavern-default-base': 'tavern/default-base.ts',
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
  it('keeps local image contracts and byte verification pure, with host-free client views', async () => {
    for (const [name, entry] of [['contracts', 'local-image-assets'], ['local-library', 'image-assets']]) {
      const root = path.resolve(PACKAGE_ROOT, '..', name);
      const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
      expect(manifest.exports[`./${entry}`]).toBe(`./src/${entry}.ts`);
      const result = await build({ entryPoints: [path.join(root, `src/${entry}.ts`)], bundle: true,
        platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
      const files = Object.keys(result.metafile!.inputs).map(file => file.replaceAll('\\', '/'));
      expect(files.some(file => /(?:apps|ui-web|hosted-runtime)\//u.test(file))).toBe(false);
      expect(findHookCalls(result.outputFiles[0].text)).toEqual([]);
    }
    const result = await build({ entryPoints: [path.join(SRC, 'local-images/index.ts')], bundle: true,
      platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
    const files = Object.keys(result.metafile!.inputs).map(file => file.replaceAll('\\', '/'));
    expect(files.some(file => /(?:apps|hosted-runtime|@tauri-apps|next)\//u.test(file))).toBe(false);
  });
  it('keeps image generation views on a browser-safe client entry separate from the pure task lifecycle', async () => {
    const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    expect(manifest.exports['./image-generation']).toBe('./src/image-generation/index.tsx');
    const bundled = await build({ entryPoints: [path.join(SRC, 'image-generation/index.tsx')],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
    const files = Object.keys(bundled.metafile!.inputs);
    expect(files.some(file => file.includes('/apps/') || file.includes('/hosted-runtime/'))).toBe(false);
    expect(files.some(file => file.endsWith('image-generation/NovelAISettingsFields.tsx'))).toBe(true);
    expect(SERVER_SAFE_ENTRYPOINTS).not.toHaveProperty('./image-generation');
  });
  it('keeps ModelScope parameter rules on one host-free client/server export', async () => {
    const aiCoreRoot = path.resolve(PACKAGE_ROOT, '../ai-core');
    const manifest = JSON.parse(readFileSync(path.join(aiCoreRoot, 'package.json'), 'utf8'));
    expect(manifest.exports['./modelscope']).toEqual({
      types: './src/modelscope.ts', import: './src/modelscope.ts', default: './src/modelscope.ts',
    });
    for (const platform of ['browser', 'node'] as const) {
      const bundled = await build({
        stdin: { contents: 'export * from "@mahoshojo/ai-core/modelscope";',
          resolveDir: path.resolve(PACKAGE_ROOT, '../../apps/web'), loader: 'ts' },
        bundle: true, platform, format: 'esm', write: false, metafile: true, logLevel: 'silent',
      });
      expect(Object.keys(bundled.metafile!.inputs).filter(file => file !== '<stdin>').map(file => path.resolve(file)))
        .toEqual([path.join(aiCoreRoot, 'src/modelscope.ts')]);
      expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
      expect(bundled.outputFiles[0].text).not.toMatch(/\b(?:window|document|localStorage|sessionStorage|indexedDB|fetch|WebSocket|process)\b/u);
      expect(Object.values(bundled.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
    }
  });
  it('keeps NovelAI settings and Prompt rules on a host-free ai-core export', async () => {
    const aiCoreRoot = path.resolve(PACKAGE_ROOT, '../ai-core');
    const manifest = JSON.parse(readFileSync(path.join(aiCoreRoot, 'package.json'), 'utf8'));
    expect(manifest.exports['./novelai']).toEqual({
      types: './src/novelai.ts', import: './src/novelai.ts', default: './src/novelai.ts',
    });
    const bundled = await build({ entryPoints: [path.join(aiCoreRoot, manifest.exports['./novelai'].import)],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
    const files = Object.keys(bundled.metafile!.inputs).map(file => file.replaceAll('\\', '/'));
    expect(files.some(file => file.endsWith('packages/ai-core/src/novelai-prompt.ts'))).toBe(true);
    expect(files.every(file => /(?:packages\/ai-core\/src\/novelai(?:-prompt)?\.ts|node_modules\/zod\/)/u.test(file))).toBe(true);
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
    expect(bundled.outputFiles[0].text).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB|fetch|WebSocket)\b/u);
    expect(Object.values(bundled.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  });
  it('keeps Tavern cloud projection pure and its controlled UI on the client barrel', async () => {
    const domainRoot = path.resolve(PACKAGE_ROOT, '../domain');
    const manifest = JSON.parse(readFileSync(path.join(domainRoot, 'package.json'), 'utf8'));
    expect(manifest.exports['./tavern-card/cloud']).toBe('./src/tavern-card/cloud.ts');
    const webPath = path.resolve(PACKAGE_ROOT, '../../apps/web/lib/tavern-card/cloud.ts');
    const pure = await build({ entryPoints: [webPath], bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
    expect(Object.keys(pure.metafile!.inputs).map(file => path.resolve(file)).sort()).toEqual([
      webPath, path.join(domainRoot, 'src/tavern-card/cloud.ts'), path.join(domainRoot, 'src/data-card-size.ts'),
    ].sort());
    expect(findHookCalls(pure.outputFiles[0].text)).toEqual([]);
    expect(pure.outputFiles[0].text).not.toMatch(/\b(?:window|document|navigator|localStorage|fetch|WebSocket)\b/u);
    expect(SERVER_SAFE_ENTRYPOINTS).not.toHaveProperty('./tavern');
    const ui = await build({
      stdin: { contents: 'export { TavernCloudSaveControls } from "@mahoshojo/ui-web/tavern";', resolveDir: path.resolve(PACKAGE_ROOT, '../../apps/web'), loader: 'ts' },
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, external: ['react', 'react/jsx-runtime'],
    });
    const liveFiles = Object.values(ui.metafile!.outputs).flatMap(output => Object.entries(output.inputs))
      .filter(([, info]) => info.bytesInOutput > 0).map(([file]) => file);
    expect(liveFiles.some(file => file.endsWith('/tavern/cloud-save-controls.tsx'))).toBe(true);
    expect(liveFiles.some(file => /(?:apps\/|next\/|@tauri-apps\/)/u.test(file))).toBe(false);
  });

  it('keeps the actual Web story buffer on the pure shared bounded preview leaf', async () => {
    const root = path.resolve(PACKAGE_ROOT, '../multiplayer-core');
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.exports['./generation-story-buffer']).toEqual({
      types: './src/generation-story-buffer.ts', import: './src/generation-story-buffer.ts', default: './src/generation-story-buffer.ts',
    });
    const webPath = path.resolve(PACKAGE_ROOT, '../../apps/web/lib/arena-room/generation-story-buffer.ts');
    const bundled = await build({ entryPoints: [webPath], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
    expect(Object.keys(bundled.metafile!.inputs).map(file => path.resolve(file)).sort())
      .toEqual([webPath, path.join(root, 'src/generation-story-buffer.ts')].sort());
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
    expect(bundled.outputFiles[0].text).not.toMatch(/\b(?:window|document|navigator|localStorage|fetch|WebSocket)\b/u);
    expect(Object.values(bundled.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  });

  it('exports the current-room result from the client barrel and keeps its own leaf host-neutral', async () => {
    const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    expect(manifest.exports['./arena-room']).toBe('./src/arena-room/index.ts');
    expect(SERVER_SAFE_ENTRYPOINTS).not.toHaveProperty('./arena-room');
    const bundled = await build({
      stdin: { contents: 'export { RoomGenerationResult } from "@mahoshojo/ui-web/arena-room";',
        resolveDir: path.resolve(PACKAGE_ROOT, '../../apps/web'), loader: 'ts' },
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
      external: ['react', 'react/jsx-runtime'],
    });
    const outputs = Object.values(bundled.metafile!.outputs).flatMap(output => Object.entries(output.inputs));
    const liveFiles = outputs.filter(([, info]) => info.bytesInOutput > 0).map(([file]) => file);
    expect(liveFiles.some(file => file.endsWith('/arena-room/RoomGenerationResult.tsx'))).toBe(true);
    expect(liveFiles.some(file => /(?:apps\/|next\/|@tauri-apps\/)/u.test(file))).toBe(false);
    // The room barrel also exports the existing member workspace. Inspect this
    // result leaf separately so unrelated workspace copy does not become its API.
    const leaf = await build({ entryPoints: [path.join(SRC, 'arena-room/RoomGenerationResult.tsx')],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
      external: ['react', 'react/jsx-runtime'] });
    expect(Object.keys(leaf.metafile!.inputs).some(file => /(?:apps\/|arena-report\/|next\/|@tauri-apps\/)/u.test(file))).toBe(false);
    expect(leaf.outputFiles[0].text).not.toMatch(/\b(?:fetch|WebSocket|localStorage|sessionStorage|indexedDB)\b/u);
  });

  it('keeps room join parsing and invite building as pure leaves shared by the Web entrypoint', async () => {
    const root = path.resolve(PACKAGE_ROOT, '../multiplayer-core');
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const names = ['room-join-code', 'room-invite'];
    for (const name of names) {
      expect(manifest.exports[`./${name}`]).toEqual({ types: `./src/${name}.ts`, import: `./src/${name}.ts`, default: `./src/${name}.ts` });
    }
    const webPath = path.resolve(PACKAGE_ROOT, '../../apps/web/lib/arena-room/join-code.ts');
    const bundled = await build({ entryPoints: [webPath],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
    expect(Object.keys(bundled.metafile!.inputs).map(file => path.resolve(file)).sort())
      .toEqual([webPath, ...names.map(name => path.join(root, `src/${name}.ts`))].sort());
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
    expect(bundled.outputFiles[0].text).not.toMatch(/\b(?:window|document|navigator|localStorage|fetch|WebSocket)\b/u);
    expect(Object.values(bundled.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  });

  it('keeps the detached member proposal model free of UI, host and persistence dependencies', async () => {
    const root = path.resolve(PACKAGE_ROOT, '../multiplayer-core');
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const entry = manifest.exports['./member-proposal'];
    expect(entry).toEqual({ types: './src/member-proposal.ts', import: './src/member-proposal.ts', default: './src/member-proposal.ts' });
    const bundled = await build({ entryPoints: [path.join(root, entry.import)],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
    const inputs = Object.keys(bundled.metafile!.inputs);
    expect(inputs.some(file => /(?:apps\/|packages\/(?:hosted-runtime|hosted-api|ui-web)\/|node_modules\/(?:react|react-dom|next|zustand|@tauri-apps)\/)/u.test(file))).toBe(false);
    expect(inputs.some(file => file.endsWith('/member-proposal-model.ts'))).toBe(true);
    expect(inputs.some(file => file.endsWith('/member-proposal-actions.ts'))).toBe(true);
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
    expect(bundled.outputFiles[0].text).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB|fetch|WebSocket)\b/u);
    expect(Object.values(bundled.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  });

  it('keeps the Web proposal editor on the runtime-neutral multiplayer core', async () => {
    const webPath = path.resolve(PACKAGE_ROOT, '../../apps/web/lib/arena-room/proposal-editor.ts');
    const bundled = await build({
      entryPoints: [webPath],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
    });
    const inputs = Object.entries(bundled.metafile!.inputs);
    const editor = inputs.find(([file]) => file.endsWith('packages/multiplayer-core/src/proposal-editor.ts'));
    expect(editor).toBeDefined();
    expect(editor![1].imports.some(({ path: imported }) => imported.endsWith('multiplayer-core/src/index.ts')))
      .toBe(false);
    expect(inputs.filter(([file]) => file.includes('apps/')).map(([file]) => path.resolve(file)))
      .toEqual([webPath]);
    expect(inputs.some(([file]) => /(?:packages\/(?:hosted-runtime|hosted-api|ui-web)\/|node_modules\/(?:react|react-dom|next|@tauri-apps)\/)/u.test(file)))
      .toBe(false);
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
    expect(Object.values(bundled.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
  });

  it('image task lifecycle exports remain browser-safe without host or credential dependencies', async () => {
    const aiCoreRoot = path.resolve(PACKAGE_ROOT, '../ai-core');
    const pkg = JSON.parse(readFileSync(path.join(aiCoreRoot, 'package.json'), 'utf8'));
    expect(pkg.exports['./image-generation']).toBe('./src/image-generation.ts');
    const bundled = await build({
      entryPoints: [path.join(aiCoreRoot, pkg.exports['./image-generation'])],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
    });
    const inputs = Object.keys(bundled.metafile!.inputs);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].endsWith('packages/ai-core/src/image-generation.ts')).toBe(true);
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
    expect(Object.values(bundled.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
  });

  it('Tavern general AI generation exports remain browser-safe without host dependencies', async () => {
    const aiCoreRoot = path.resolve(PACKAGE_ROOT, '../ai-core');
    const pkg = JSON.parse(readFileSync(path.join(aiCoreRoot, 'package.json'), 'utf8'));
    expect(pkg.exports['./tavern-generation']).toBe('./src/tavern-generation.ts');
    const bundled = await build({
      entryPoints: [path.join(aiCoreRoot, pkg.exports['./tavern-generation'])],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
    });
    const inputs = Object.keys(bundled.metafile!.inputs);
    expect(inputs.some((file) => file.endsWith('packages/ai-core/src/tavern-generation.ts'))).toBe(true);
    expect(inputs.some((file) => /(?:packages\/(?:hosted-runtime|hosted-api|ui-web)\/|apps\/|node_modules\/react\/)/u.test(file))).toBe(false);
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
    expect(Object.values(bundled.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
  });

  it('keeps the Hosted/Desktop story request constructor on its own client-safe entrypoint', async () => {
    const domainRoot = path.resolve(PACKAGE_ROOT, '../domain');
    const pkg = JSON.parse(readFileSync(path.join(domainRoot, 'package.json'), 'utf8'));
    expect(pkg.exports['./arena-battle-story-request']).toBe('./src/arena-battle-story-request.ts');
    const bundled = await build({
      entryPoints: [path.join(domainRoot, pkg.exports['./arena-battle-story-request'])],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
    });
    const inputs = Object.keys(bundled.metafile!.inputs);
    expect(inputs.some((file) => file.endsWith('packages/domain/src/arena-battle-story-request.ts'))).toBe(true);
    expect(inputs.some((file) => /(?:packages\/(?:hosted-runtime|hosted-api|ui-web)\/|apps\/|node_modules\/react\/)/u.test(file))).toBe(false);
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
    expect(bundled.outputFiles[0].text).not.toContain('fetch(');
    expect(Object.values(bundled.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
  });

  it('keeps strict range filtering and server settlement on one pure domain rule', async () => {
    const root = path.resolve(PACKAGE_ROOT, '../domain');
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.exports['./arena-strict-range']).toBe('./src/arena-strict-range.ts');
    const entry = path.resolve(PACKAGE_ROOT, '../../apps/web/lib/arena/strict-range.ts');
    const bundled = await build({ entryPoints: [entry], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
    expect(Object.keys(bundled.metafile!.inputs).map(file => path.resolve(file)).sort()).toEqual([
      entry, path.join(root, 'src/arena-strict-range.ts'), path.join(root, 'src/arena-tier.ts'),
    ].sort());
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
    expect(bundled.outputFiles[0].text).not.toMatch(/\b(?:window|document|localStorage|fetch|WebSocket)\b/u);
    for (const file of ['lib/database/arena-ratings.ts']) {
      const source = readFileSync(path.resolve(PACKAGE_ROOT, '../../apps/web', file), 'utf8');
      expect(source).toContain("from '@/lib/arena/strict-range'");
      expect(source).not.toContain('const STRICT_MAX_ABS_DIFF_BY_TIER');
    }
    const sharedView = readFileSync(path.join(PACKAGE_ROOT, 'src/ranking/ArenaRankingModalView.tsx'), 'utf8');
    expect(sharedView).toContain("from '@mahoshojo/domain/arena-strict-range'");
    expect(sharedView).not.toContain('const STRICT_MAX_ABS_DIFF_BY_TIER');
    const webAdapter = readFileSync(path.resolve(PACKAGE_ROOT, '../../apps/web/components/arena/components/ArenaRankingModal.tsx'), 'utf8');
    expect(webAdapter).toContain('<ArenaRankingModalView');
    expect(webAdapter).not.toContain('getStrictRangeCheckResult');
  });

  // Web 服务端预设校验与 picker 共用纯 domain 目录；不能误归到 ui-web 的客户端列表。
  for (const name of ['presets', 'scenario-presets']) {
    it(`domain/${name} remains a pure, explicitly exported Web-consumed catalog`, async () => {
      const domainRoot = path.resolve(PACKAGE_ROOT, '../domain');
      const pkg = JSON.parse(readFileSync(path.join(domainRoot, 'package.json'), 'utf8'));
      expect(pkg.exports[`./${name}`]).toBe(`./src/${name}.ts`);
      const webPath = path.resolve(PACKAGE_ROOT, `../../apps/web/lib/${name}.ts`);
      expect(readFileSync(webPath, 'utf8')).toContain(`export * from '@mahoshojo/domain/${name}'`);
      const bundled = await build({ entryPoints: [webPath], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
      const inputs = Object.keys(bundled.metafile!.inputs);
      expect(inputs.some((file) => file.endsWith(`packages/domain/src/${name}.ts`))).toBe(true);
      expect(inputs).toHaveLength(2);
      expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
      expect(bundled.outputFiles[0].text).not.toContain('fetch(');
    });
  }

  for (const [subpath, relativeFile] of Object.entries(SERVER_SAFE_ENTRYPOINTS)) {
    it(`${subpath} imports no React hook`, () => {
      const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
        exports: Record<string, string | { import?: string; default?: string }>;
      };
      const exported = manifest.exports[subpath];
      const target = typeof exported === 'string' ? exported : exported?.import ?? exported?.default;
      // 检查公开入口实际指向被扫描的纯叶子，避免出口改到客户端 barrel 后仍验证旧路径。
      expect(target).toBe(`./src/${relativeFile}`);
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

  it('keeps the actual Web Tea Party server import graph in pure shared core', async () => {
    const aiCoreRoot = path.resolve(PACKAGE_ROOT, '../ai-core');
    const aiCorePackage = JSON.parse(readFileSync(path.join(aiCoreRoot, 'package.json'), 'utf8'));
    expect(aiCorePackage.exports['./magic-tea-party']).toBe('./src/magic-tea-party/index.ts');
    const bundled = await build({
      entryPoints: [path.resolve(PACKAGE_ROOT, '../../apps/web/lib/magic-tea-party/presets.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    const inputs = Object.keys(bundled.metafile!.inputs);
    expect(inputs.some((file) => file.endsWith('packages/ai-core/src/magic-tea-party/presets.ts'))).toBe(true);
    expect(inputs.some((file) => file.endsWith('packages/domain/src/tavern-card/worldbook.ts'))).toBe(true);
    expect(inputs.some((file) => file.includes('packages/ui-web/'))).toBe(false);
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
  });

  it('keeps the actual Hosted name generation graph in shared pure prompt/schema', async () => {
    const bundled = await build({
      entryPoints: [path.resolve(PACKAGE_ROOT, '../hosted-runtime/src/generate-magical-girl-runtime.ts')],
      bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent',
    });
    const files = Object.keys(bundled.metafile!.inputs);
    expect(files.some(file => file.endsWith('packages/ai-core/src/name-generation.ts'))).toBe(true);
    expect(files.some(file => file.endsWith('packages/domain/src/name-generation.ts'))).toBe(true);
    expect(files.some(file => file.includes('packages/ui-web/') || file.includes('/apps/'))).toBe(false);
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
  });

  it('keeps the Tea import plan as a pure domain entry with no UI or host imports', async () => {
    const root = path.resolve(PACKAGE_ROOT, '../domain');
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.exports['./magic-tea-party/import-plan']).toBe('./src/magic-tea-party/import-plan.ts');
    const result = await build({ entryPoints: [path.join(root, 'src/magic-tea-party/import-plan.ts')], bundle: true,
      platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
    const files = Object.keys(result.metafile!.inputs);
    expect(files.some(file => file.endsWith('/magic-tea-party/transfer.ts'))).toBe(true);
    expect(files.some(file => file.includes('/apps/') || file.includes('/ui-web/'))).toBe(false);
    expect(findHookCalls(result.outputFiles[0].text)).toEqual([]);
  });

  it('keeps the Tea role editor projection pure behind its explicit domain export', async () => {
    const root = path.resolve(PACKAGE_ROOT, '../domain');
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.exports['./magic-tea-party/role-editor']).toBe('./src/magic-tea-party/role-editor.ts');
    const result = await build({ entryPoints: [path.join(root, 'src/magic-tea-party/role-editor.ts')], bundle: true,
      platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
    const files = Object.keys(result.metafile!.inputs);
    expect(files.some(file => file.includes('/apps/') || file.includes('/ui-web/'))).toBe(false);
    expect(findHookCalls(result.outputFiles[0].text)).toEqual([]);
  });

  it('keeps the battle report text leaf free of view hooks', () => {
    const graph = collectModuleGraph(path.join(SRC, 'arena-report/text.ts'));
    expect(graph.length).toBeGreaterThan(1);
    for (const file of graph) expect(findHookCalls(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('keeps the Web story-length server helper in the pure domain graph', async () => {
    const bundled = await build({
      entryPoints: [path.resolve(PACKAGE_ROOT, '../../apps/web/lib/story-length.ts')],
      bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent',
    });
    const inputs = Object.keys(bundled.metafile!.inputs);
    expect(inputs.some((file) => file.endsWith('packages/domain/src/story-length.ts'))).toBe(true);
    expect(inputs.some((file) => file.includes('packages/ui-web/'))).toBe(false);
    expect(findHookCalls(bundled.outputFiles[0].text)).toEqual([]);
  });

});
