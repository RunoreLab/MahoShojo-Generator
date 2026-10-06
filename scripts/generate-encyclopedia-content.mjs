/**
 * 把仓库根 `content/` 的产品内容同步到两个 app 的静态服务根。
 *
 * ## 为什么需要它
 *
 * 百科正文、共享问卷与品牌资源要同时出现在两个产物里：Web 由 `public/` 提供，Desktop 由 Tauri 自定义协议
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
 * 里的 typed catalog，由本脚本**校验引用完整性**而不是生成它——把那 52 条元数据改成从 Markdown
 * frontmatter 推导，是一次独立的格式迁移，不属于 D3.0。
 *
 * 用法：`node scripts/generate-encyclopedia-content.mjs [--target web|desktop] [--check|--check-output]`
 * `--check` 只读校验源；`--check-output` 另校验已生成文件；缺省生成两个宿主。
 */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONTENT_ROOT = path.join(root, 'content');
const BRAND_DIR = path.join(CONTENT_ROOT, 'brand');
const ENCYCLOPEDIA_DIR = path.join(CONTENT_ROOT, 'encyclopedia');
const QUESTIONNAIRE_DIR = path.join(CONTENT_ROOT, 'questionnaires', 'presets');
const QUESTIONNAIRE_CATALOG_FILE = 'index.json';
/**
 * 双端同源的根级 JSON 资产。
 *
 * `languages.json` 由问卷页语言选择直接 fetch；`announcements.json` 是公告内容权威源：
 * Web 由 `public/` 同源伺服，Desktop 的同源副本是**内置快照**——renderer fetch 它不发
 * 任何网络请求，远端刷新走 native 受控通道（DESK-PARITY-003）。
 */
const SHARED_ROOT_JSON = ['languages.json', 'announcements.json'];

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
/**
 * 每个 app 同步哪些品牌资源由 manifest 决定，而不是「全部同步」。
 *
 * Desktop 只同步已交付入口的资源；D3.1 默认问卷的 logo 已加入 shared，其余 Web 专用入口仍不打包。
 */
const TARGETS = [
  // `shared` 是两端都要的资源；Web 另外还要它首页功能卡的那一批。
  { app: 'apps/web', label: 'Web', keys: ['shared', 'web'] },
  { app: 'apps/desktop', label: 'Desktop', keys: ['shared'] },
];

const SYNC_MANIFEST = path.join(CONTENT_ROOT, 'sync-manifest.json');

/**
 * 共源首页功能目录的资源引用。
 *
 * D5.1-P1 后目录本身就是共源事实（`@mahoshojo/ui-web/home` 的 `HOME_FEATURE_CATEGORIES`）：
 * 两端都消费它，再由各自的能力快照投影出可执行子集。这里验证的是目录引用的每个
 * `assetFile` 真的存在于 `content/brand/` 且登记进了对应宿主的同步清单。
 */
const HOME_FEATURE_CATALOG = path.join(
  root,
  'packages',
  'ui-web',
  'src',
  'home',
  'feature-catalog.ts',
);

const readManifest = async () => {
  const manifest = JSON.parse(await readFile(SYNC_MANIFEST, 'utf8'));
  if (!manifest.brand || !Array.isArray(manifest.brand.shared) || !Array.isArray(manifest.brand.web)) {
    throw new Error(`${path.relative(root, SYNC_MANIFEST)} 需要 brand.shared 与 brand.web 两个数组`);
  }
  for (const names of [manifest.brand.shared, manifest.brand.web]) {
    if (new Set(names).size !== names.length || names.some((name) => typeof name !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/i.test(name))) {
      throw new Error('品牌资源清单必须是无重复的根目录文件名，不允许路径');
    }
  }
  return manifest;
};

const readHomeFeatureAssets = async () => {
  const transpiled = await build({
    entryPoints: [HOME_FEATURE_CATALOG],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const output = transpiled.outputFiles[0];
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`
  );
  const categories = module.HOME_FEATURE_CATEGORIES;
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error(`首页目录没有导出 HOME_FEATURE_CATEGORIES：${HOME_FEATURE_CATALOG}`);
  }
  return categories.flatMap((category) => category.features.map((feature) => feature.assetFile));
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
  if (!check) await mkdir(to, { recursive: true });

  const existing = new Set(await readdir(to).catch(() => []));
  for (const name of files) {
    const sourcePath = path.join(from, name);
    const source = await readFile(sourcePath).catch(() => null);
    if (source === null) {
      // manifest 指向一个已被删除的资源。让它进入 problems 而不是抛 ENOENT：门禁失败时应该一次
      // 列出所有问题，而不是在第一个就崩掉。
      problems.push(`${path.relative(root, sourcePath)} 不存在，请修正 sync-manifest 或 content/brand/`);
      existing.delete(name);
      continue;
    }

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

/**
 * 品牌资源与首页目录的一致性。
 *
 * 方向是单向的：目录引用了不存在的资源会让页面出现裂图，而 content/brand/ 里多出来的资源只是
 * 尚未启用（或者已经废弃但还没删），因此不报错——但它必须真的存在于 content/brand/，否则
 * 「资源权威在 content/」这件事就不成立。
 */
const collectBrandProblems = async (brandFiles, referencedByCatalog, manifest) => {
  const problems = [];
  const available = new Set(brandFiles);

  for (const assetFile of referencedByCatalog) {
    if (!available.has(assetFile)) {
      problems.push(`首页目录引用了 content/brand/ 里不存在的资源 ${assetFile}`);
    }
    if (!manifest.brand.shared.includes(assetFile) && !manifest.brand.web.includes(assetFile)) {
      problems.push(`首页资源 ${assetFile} 未登记到 Web 同步清单`);
    }
  }

  const owned = new Set([...manifest.brand.shared, ...manifest.brand.web]);
  for (const name of owned) {
    if (!available.has(name)) {
      problems.push(`sync-manifest 登记了 content/brand/ 里不存在的资源 ${name}`);
    }
  }

  const duplicated = [...manifest.brand.shared].filter((name) => manifest.brand.web.includes(name));
  if (duplicated.length > 0) {
    problems.push(`以下资源同时登记在 shared 与 web：${duplicated.join(', ')}`);
  }

  return problems;
};

export async function generate({ check = false, checkOutput = false, target = 'all', outputRoot = root } = {}) {
  if (!['all', 'web', 'desktop'].includes(target)) throw new Error(`未知同步目标：${target}`);
  const problems = [];
  const entries = await readCatalogEntries();
  const manifest = await readManifest();

  const encyclopediaFiles = await listFiles(ENCYCLOPEDIA_DIR, '.md');
  const brandFiles = await listFiles(BRAND_DIR, '');
  problems.push(...(await collectProblems(encyclopediaFiles, entries)));
  problems.push(...(await collectBrandProblems(brandFiles, await readHomeFeatureAssets(), manifest)));
  const questionnaireFiles = await listFiles(QUESTIONNAIRE_DIR, '.json');
  if (!questionnaireFiles.includes(QUESTIONNAIRE_CATALOG_FILE)) {
    problems.push(`预设问卷目录缺少 ${QUESTIONNAIRE_CATALOG_FILE}`);
  }
  for (const file of questionnaireFiles) {
    if (file === QUESTIONNAIRE_CATALOG_FILE) continue;
    const questionnaire = JSON.parse(await readFile(path.join(QUESTIONNAIRE_DIR, file), 'utf8'));
    // kind 为字符串即可（magical-girl/canshou 均合法）；questions 允许为空数组——
    // 纯 lore 预设没有题目，靠 loreMarkdown 参与多问卷组合。
    if (questionnaire.id !== file.slice(0, -5) || typeof questionnaire.kind !== 'string' || !Array.isArray(questionnaire.questions)) {
      problems.push(`共享问卷 ${file} 的身份或题目列表无效`);
    }
    if (!manifest.brand.shared.includes(questionnaire.logoUrl?.slice(1))) {
      problems.push(`共享问卷 ${file} 的 logo 未登记为共享品牌资源`);
    }
  }
  // 花名数据由 domain 直接消费；这里只维护 Web 既有 URL 的兼容副本。
  JSON.parse(await readFile(path.join(CONTENT_ROOT, 'flowers.json'), 'utf8'));
  // 语言清单同步到双端 public；内容本身由 fetch 消费，这里只校验是合法 JSON 数组。
  const languages = JSON.parse(await readFile(path.join(CONTENT_ROOT, 'languages.json'), 'utf8'));
  if (!Array.isArray(languages) || languages.length === 0) {
    problems.push('languages.json 必须是非空数组');
  }

  // 在写入前检查全部源文件；--check 不依赖开发机残留的 public/ 生成物，也不写磁盘。
  if (problems.length > 0) throw new Error(`百科内容源校验失败：\n- ${problems.join('\n- ')}`);
  if (check && !checkOutput) {
    console.log(`content/ 源校验通过：${entries.length} 篇正文、${brandFiles.length} 个品牌资源、${questionnaireFiles.length - 1} 份预设问卷及花名/语言数据`);
    return;
  }

  for (const { app, label, keys } of TARGETS) {
    if (target !== 'all' && app !== `apps/${target}`) continue;
    const publicRoot = path.join(outputRoot, app, 'public');

    // 预设目录全量由本脚本拥有：增删预设只改 content/，双端副本一致剪除。
    await syncDirectory({
      from: QUESTIONNAIRE_DIR,
      to: path.join(publicRoot, 'questionnaires', 'presets'),
      files: questionnaireFiles,
      ownedFiles: questionnaireFiles,
      exclusive: true,
      check: checkOutput,
      problems,
    });
    await syncDirectory({
      from: CONTENT_ROOT,
      to: publicRoot,
      files: SHARED_ROOT_JSON,
      ownedFiles: SHARED_ROOT_JSON,
      exclusive: false,
      check: checkOutput,
      problems,
    });
    if (app === 'apps/web') {
      await syncDirectory({
        from: CONTENT_ROOT,
        to: publicRoot,
        files: ['flowers.json'],
        ownedFiles: ['flowers.json'],
        exclusive: false,
        check: checkOutput,
        problems,
      });
    }

    await syncDirectory({
      from: ENCYCLOPEDIA_DIR,
      to: path.join(publicRoot, 'encyclopedia'),
      files: encyclopediaFiles,
      exclusive: true,
      check: checkOutput,
      problems,
    });
    await syncDirectory({
      from: BRAND_DIR,
      to: publicRoot,
      files: [...new Set(keys.flatMap((key) => manifest.brand[key]))].sort(),
      ownedFiles: [...manifest.brand.shared, ...manifest.brand.web],
      exclusive: false,
      check: checkOutput,
      problems,
    });

    console.log(
      `${label} 内容 ${checkOutput ? '已校验' : '已同步'}：${encyclopediaFiles.length} 篇正文、${keys.flatMap((key) => manifest.brand[key]).length} 个品牌资源、${questionnaireFiles.length - 1} 份预设问卷`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`百科内容同步门禁失败：\n- ${problems.join('\n- ')}`);
  }

  const catalogDigest = digest(Buffer.from(entries.map((entry) => entry.contentFile).join('\n')));
  console.log(`content/ 校验通过：目录 ${entries.length} 条，指纹 ${catalogDigest.slice(0, 12)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const targetIndex = args.indexOf('--target');
  generate({ check: args.includes('--check'), checkOutput: args.includes('--check-output'), target: targetIndex < 0 ? 'all' : args[targetIndex + 1] ?? '' }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
