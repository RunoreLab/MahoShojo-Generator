/**
 * 把仓库根 `content/` 的产品内容同步到两个 app 的静态服务根。
 *
 * ## 为什么需要它
 *
 * 百科正文与首页品牌资源要同时出现在两个产物里：Web 由 `public/` 提供，Desktop 由 Tauri 自定义协议
 * 伺服 `dist/`（`frontendDist` 目录会被递归嵌入）。而这两条路都不接受「从别处按需读取」——共享包里
 * 的 `import.meta.glob` 在本仓当前的 webpack `next build` 下不成立（dev 通过、build 静默失败），裸
 * `?raw` 是 Vite 专有语法。所以内容在**构建期**被复制到两个服务根，运行时只做同源的普通 fetch。
 *
 * ## 为什么不把内容放在某个 app 里
 *
 * `apps/web/public/encyclopedia/` 曾经是权威。那让 Desktop 的离线内容依赖 Web 的目录布局，正是
 * `ADR-desktop-shared-product` §3 要消除的耦合：Web 改一次目录结构，Desktop 就会静默少一批内容。
 * 内容是产品资产，因此权威在仓库根 `content/`，两个 app 的副本都是**生成物**。
 *
 * ## 它是复制，不是转换
 *
 * 正文逐字节复制。目录数据（标题/摘要/分类/关键词）仍然是 `packages/ui-web/src/encyclopedia/catalog.ts`
 * 里的 typed catalog，由本脚本**校验引用完整性**而不是生成它——把那 53 条元数据改成从 Markdown
 * frontmatter 推导，是一次独立的格式迁移，不属于 D3.0。
 *
 * 用法：`node scripts/generate-encyclopedia-content.mjs [--check]`
 */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONTENT_ROOT = path.join(root, 'content');
const BRAND_DIR = path.join(CONTENT_ROOT, 'brand');
const ENCYCLOPEDIA_DIR = path.join(CONTENT_ROOT, 'encyclopedia');

/**
 * 目录数据的权威位置。
 *
 * 它是 `@mahoshojo/ui-web/encyclopedia` 的一个源文件，而不是它的构建产物：共享包源码直发，没有 build
 * 步骤（`packages/README.md`）。因此这里用 esbuild 就地转译再求值，形状与
 * `scripts/generate-web-package-presets.mjs` 一致。
 */
const CATALOG_MODULE = path.join(
  root,
  'packages',
  'ui-web',
  'src',
  'encyclopedia',
  'catalog.ts',
);

/**
 * 同步目标。
 *
 * `public/` 落在**静态服务根**，而不是构建配置里的某个数组：Vite 的 `publicDir` 不支持数组（vite#16138），
 * 而 Next 的 `public/` 本来就是固定目录。两端在这里形状相同，脚本因此不需要分支。
 *
 * 注意 `apps/web/public/` 是共享命名空间：除品牌资源外还有 50 多个与本脚本无关的文件（JSON 种子、
 * 预设、favicon 等）。因此脚本**不**扫描并剪除整个根目录，而是只对 `sync-manifest.json` 登记过的文件名
 * 负责——否则一次 `rm` 就会删掉别人的资源。
 */
const TARGETS = [
  { app: 'apps/web', label: 'Web' },
  { app: 'apps/desktop', label: 'Desktop' },
];

const SYNC_MANIFEST = path.join(CONTENT_ROOT, 'sync-manifest.json');

const readOwnedBrandFiles = async () => {
  const manifest = JSON.parse(await readFile(SYNC_MANIFEST, 'utf8'));
  if (!Array.isArray(manifest.brand)) {
    throw new Error(`${path.relative(root, SYNC_MANIFEST)} 缺少 brand 数组`);
  }
  return manifest.brand;
};

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

const listFiles = async (directory, extension) => {
  const names = await readdir(directory);
  return names.filter((name) => name.endsWith(extension)).sort();
};

const readCatalogEntries = async () => {
  const transpiled = await build({
    entryPoints: [CATALOG_MODULE],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const output = transpiled.outputFiles[0];
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`
  );
  const entries = module.encyclopediaEntries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`目录数据没有导出 encyclopediaEntries：${CATALOG_MODULE}`);
  }
  return entries;
};

/**
 * 引用完整性，两个方向都要查。
 *
 * 只查「catalog 指向的文件存在」不够：那会漏掉 `content/encyclopedia/` 里多出来的孤儿文件——它在 Web 上
 * 看起来完全正常，只是永远没有任何入口能到达它，而这种文件在 Desktop 上会一起进安装包。
 */
const collectProblems = async (contentFiles, entries) => {
  const problems = [];

  const known = new Set(contentFiles);
  for (const entry of entries) {
    if (!known.has(entry.contentFile)) {
      problems.push(`目录条目 ${entry.slug} 引用了不存在的正文 ${entry.contentFile}`);
    }

    // slug 与正文文件名保持一致，是「条目在 /encyclopedia/<slug>、正文在 /encyclopedia/<slug>.md」
    // 这两处寻址能共用同一个标识的前提。允许它们分叉会让目录页的链接与正文 URL 需要两套映射，
    // 而那正是本切片要消除的东西。历史别名（旧 slug）走 catalog 里的 alias map，不受影响。
    const expectedFile = `${entry.slug}.md`;
    if (entry.contentFile !== expectedFile) {
      problems.push(`目录条目 ${entry.slug} 的正文文件名应为 ${expectedFile}，实际是 ${entry.contentFile}`);
    }
  }

  const referenced = new Set(entries.map((entry) => entry.contentFile));
  for (const file of contentFiles) {
    if (!referenced.has(file)) {
      problems.push(`正文 ${file} 未在目录中登记，任何入口都无法到达它`);
    }
  }

  return problems;
};

/**
 * 同步一个目录。
 *
 * `exclusive` 为真时本脚本拥有整个目标目录（百科子目录），因此可以双向剪除；为假时只处理
 * `ownedFiles` 登记过的文件名（品牌资源所在的 `public/` 根目录）。
 */
const syncDirectory = async ({ from, to, files, ownedFiles, exclusive, check, problems }) => {
  await mkdir(to, { recursive: true });

  const existing = new Set(await readdir(to).catch(() => []));
  for (const name of files) {
    const source = await readFile(path.join(from, name));
    const targetPath = path.join(to, name);
    // 无论是否写入都要从 `existing` 里移除：留在集合里就意味着「目标有而 content/ 没有」，
    // 那与本文件是否已同步无关。
    existing.delete(name);

    if (check) {
      const current = await readFile(targetPath).catch(() => null);
      if (current === null) {
        problems.push(`${path.relative(root, targetPath)} 缺失，请运行生成脚本`);
      } else if (!current.equals(source)) {
        problems.push(`${path.relative(root, targetPath)} 与 content/ 不同步，请运行生成脚本`);
      }
      continue;
    }

    await writeFile(targetPath, source);
  }

  // 目标里多出来的文件说明 content/ 曾经删过或改过名。留着它会让两个 app 继续伺服一份不再存在的
  // 产品内容，而且没有任何门禁会报警。
  const staleCandidates = exclusive
    ? [...existing]
    : ownedFiles.filter((name) => existing.has(name));
  for (const stale of staleCandidates.sort()) {
    const stalePath = path.join(to, stale);
    if (check) {
      problems.push(`${path.relative(root, stalePath)} 已不在 content/ 中，请运行生成脚本`);
      continue;
    }

    // 这个脚本会在 workspace 门禁里跑，因此「删错文件」的代价是两个 app 同时丢资源，而症状要等到
    // 真机运行时才出现。目录一律不删：下面那条 stat 检查让误删以明确的错误停下来，而不是留下一半
    // 被删掉的 public/ 目录。
    const stats = await lstat(stalePath).catch(() => null);
    if (stats?.isDirectory()) {
      throw new Error(
        `拒绝删除目录 ${path.relative(root, stalePath)}：本脚本只维护自己登记过的文件。若 content/ 的结构变了，请同步更新 content/sync-manifest.json。`,
      );
    }
    await rm(stalePath, { force: true });
  }
};

export async function generate({ check = false } = {}) {
  const problems = [];
  const entries = await readCatalogEntries();

  const encyclopediaFiles = await listFiles(ENCYCLOPEDIA_DIR, '.md');
  const brandFiles = await listFiles(BRAND_DIR, '');
  problems.push(...(await collectProblems(encyclopediaFiles, entries)));

  const ownedBrandFiles = await readOwnedBrandFiles();
  const expectedOwned = [...brandFiles].sort();
  if (JSON.stringify([...ownedBrandFiles].sort()) !== JSON.stringify(expectedOwned)) {
    problems.push(
      `content/sync-manifest.json 登记的品牌资源与 content/brand/ 不一致：登记 ${[...ownedBrandFiles].sort().join(', ')}，实际 ${expectedOwned.join(', ')}`,
    );
  }

  for (const { app, label } of TARGETS) {
    const publicRoot = path.join(root, app, 'public');
    await mkdir(publicRoot, { recursive: true });

    await syncDirectory({
      from: ENCYCLOPEDIA_DIR,
      to: path.join(publicRoot, 'encyclopedia'),
      files: encyclopediaFiles,
      exclusive: true,
      check,
      problems,
    });
    await syncDirectory({
      from: BRAND_DIR,
      to: publicRoot,
      files: brandFiles,
      ownedFiles: ownedBrandFiles,
      exclusive: false,
      check,
      problems,
    });

    console.log(
      `${label} 百科内容 ${check ? '已校验' : '已同步'}：${encyclopediaFiles.length} 篇正文、${brandFiles.length} 个品牌资源`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`百科内容同步门禁失败：\n- ${problems.join('\n- ')}`);
  }

  const catalogDigest = digest(Buffer.from(entries.map((entry) => entry.contentFile).join('\n')));
  console.log(`content/ 校验通过：目录 ${entries.length} 条，指纹 ${catalogDigest.slice(0, 12)}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  generate({ check: process.argv.includes('--check') }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}