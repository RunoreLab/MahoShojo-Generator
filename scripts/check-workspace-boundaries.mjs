import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import parser from '@typescript-eslint/parser';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.open-next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  // Rust 构建树。apps/desktop/src-tauri/target 体积巨大且不含需要参与边界检查的源码，
  // 不忽略会让每次门禁都遍历整个 target 目录。
  'target',
]);
const ROOT_TOOLING_DIRECTORIES = ['scripts', 'tests'];
const CLIENT_PACKAGE_NAMES = new Set(['ai-direct', 'local-library', 'cloud-client', 'ui-web']);
/**
 * 承载共源 React DOM 页面的共享包（`ADR-desktop-shared-product` §3）。
 *
 * 与 `CLIENT_PACKAGE_NAMES` 分开而不是合并：客户端包的共同点是"不得接触服务器秘密"，而共享 UI 的
 * 额外义务是"不得绑定任何具体宿主"。两者会随切片增长，合并成一个集合会让新增规则的作用范围
 * 只能靠读代码推断。
 */
const SHARED_UI_PACKAGE_NAMES = new Set(['ui-web']);
const REQUIRED_WORKSPACE_SCRIPTS = ['test', 'lint', 'build'];
const LEGACY_ROOT_APP_DIRECTORIES = new Set([
  'app',
  'components',
  'lib',
  'pages',
  'public',
  'server',
  'styles',
  'types',
]);
const DOM_GLOBAL_IDENTIFIERS = new Set([
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'location',
  'history',
  'screen',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
  'File',
  'FileReader',
  'Blob',
  'FormData',
  'WebSocket',
]);
const CONTRACTS_BROWSER_ONLY_GLOBALS = new Set([
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'location',
  'history',
  'screen',
  'HTMLElement',
  'Element',
  'Node',
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
  'FileReader',
]);

const NODE_RUNTIME_MODULE = /^(?:node:|assert(?:\/|$)|buffer(?:\/|$)|child_process(?:\/|$)|cluster(?:\/|$)|crypto(?:\/|$)|dgram(?:\/|$)|dns(?:\/|$)|events(?:\/|$)|fs(?:\/|$)|http(?:\/|$)|https(?:\/|$)|module(?:\/|$)|net(?:\/|$)|os(?:\/|$)|path(?:\/|$)|perf_hooks(?:\/|$)|process(?:\/|$)|readline(?:\/|$)|stream(?:\/|$)|string_decoder(?:\/|$)|timers(?:\/|$)|tls(?:\/|$)|tty(?:\/|$)|url(?:\/|$)|util(?:\/|$)|v8(?:\/|$)|vm(?:\/|$)|worker_threads(?:\/|$)|zlib(?:\/|$))/;
const FRAMEWORK_RUNTIME_MODULE = /^(?:next(?:\/|$)|react(?:\/|$)|react-dom(?:\/|$)|hono(?:\/|$)|@hono\/(?:.+)|wrangler(?:\/|$)|cloudflare:.+|cloudflare(?:\/|$)|@cloudflare\/(?:.+)|@opennextjs\/(?:.+)|@tauri\/(?:.+)|@tauri-apps\/(?:.+)|tauri(?:\/|$)|electron(?:\/|$)|@electron\/(?:.+)|drizzle-orm(?:\/|$)|better-sqlite3(?:\/|$)|kysely(?:\/|$)|redis(?:\/|$)|ioredis(?:\/|$)|pg(?:\/|$)|mysql2(?:\/|$)|sqlite3(?:\/|$)|@libsql\/(?:.+)|idb(?:\/|$)|indexeddb(?:\/|$))/;

/**
 * 共享 UI 不得导入的具体模块名。
 *
 * 它与 {@link FRAMEWORK_RUNTIME_MODULE} 的差别是**故意不含 `react` / `react-dom`**：那条正则服务
 * `domain` 与 `contracts`，对它们来说 React 和 Next 一样是需要排除的框架依赖；而共享 UI 的全部职责
 * 就是产出 React DOM 组件，把 React 一起禁掉会让规则本身无法成立。
 *
 * 因此这里不用正则而用精确名集合加命名空间前缀：`cloudflare` 与 `ioredis` 这类前缀重叠的名字，
 * 用 `startsWith` 会把 `cloudflare-kit`、`ioredis-mock` 一并误判，而误报会让门禁很快被绕过。
 */
const SHARED_UI_FORBIDDEN_RUNTIME_MODULES = new Set([
  'better-sqlite3',
  'cloudflare',
  'drizzle-orm',
  'electron',
  'hono',
  'idb',
  'indexeddb',
  'ioredis',
  'kysely',
  'mysql2',
  'next',
  'pg',
  'redis',
  'sqlite3',
  'tauri',
  'wrangler',
]);
/** 上面那些包名带子路径时的匹配前缀。仓内已实际出现的形式是 `next/server` 与 `@tauri-apps/api/core`。 */
const SHARED_UI_FORBIDDEN_RUNTIME_PREFIXES = [
  '@cloudflare/',
  '@electron/',
  '@hono/',
  '@libsql/',
  '@opennextjs/',
  '@tauri-apps/',
  '@tauri/',
  'cloudflare:',
  'drizzle-orm/',
  'hono/',
  'next/',
  'node:',
  'tauri/',
];
/**
 * Tauri 插件的 JS 侧有两种命名，`tauri(?:\/|$)` 之类的正则**两种都匹配不到**。
 *
 * 这不是假想：`tauri-plugin-opener` 是 Tauri v2 官方插件的正式包名，漏掉它就等于给共享 UI
 * 留了一条装 opener/fs/dialog 的后门，而这类插件正是最不该由共源页面直接持有的能力。
 */
const TAURI_PLUGIN_MODULE = /^(?:tauri-plugin-|@tauri-apps\/plugin-)/;

/**
 * @param {string} moduleSpecifier
 * @returns {boolean}
 */
function isSharedUiForbiddenRuntime(moduleSpecifier) {
  if (SHARED_UI_FORBIDDEN_RUNTIME_MODULES.has(moduleSpecifier)) return true;
  if (TAURI_PLUGIN_MODULE.test(moduleSpecifier)) return true;
  return SHARED_UI_FORBIDDEN_RUNTIME_PREFIXES.some((prefix) => moduleSpecifier.startsWith(prefix));
}

const SECRET_MODULE_SEGMENT = /(^|[\\/_.-])(server|secret|secrets|signature|signatures|env|environment|environments|private)(?=$|[\\/_.-])/i;
const CONTRACTS_EXCLUDED_SOURCE_SUFFIX = /\.(test|spec|config)\./i;

/**
 * `content/` 是这些静态文件的权威源，app `public/` 只是构建期生成物。
 *
 * 不是所有 `public/` 内容都属于百科内容生成器：各宿主仍可以拥有自己的 JSON 种子、预设和图标。
 * 因此这里先登记生成器固定维护的路径，再从 sync-manifest 补充品牌资源，而不是把整个 public/ 一刀切掉。
 */
const CORE_GENERATED_PUBLIC_PATHS = Object.freeze({
  web: new Set(['flowers.json', 'questionnaires/presets/magical-girl-default.json']),
  desktop: new Set(['questionnaires/presets/magical-girl-default.json']),
});

/**
 * 生成器以 exclusive 模式整目录维护的 public 子树，以及非 manifest 的生成根文件。
 * 与 `generatedPublicPaths`（import 边界用的文件级清单）不同，这里要覆盖到目录本身——
 * Git 护栏按路径前缀判定。
 */
export const GENERATED_PUBLIC_DIRECTORIES = Object.freeze(['encyclopedia', 'questionnaires/presets', 'presets', 'scenario-presets']);
export const GENERATED_PUBLIC_ROOT_FILES = Object.freeze(['languages.json', 'announcements.json']);

/**
 * @typedef {'apps' | 'packages'} WorkspaceKind
 * @typedef {{ kind: WorkspaceKind, name: string, directory: string, packageJsonPath: string | null, manifest: Record<string, any> | null, sourceFiles: string[] }} WorkspaceUnit
 * @typedef {{ rule: string, file: string, line?: number, module: string, message: string }} BoundaryViolation
 */

function isDirectory(targetPath) {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(targetPath) {
  try {
    return statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function readManifest(packageJsonPath) {
  if (!existsSync(packageJsonPath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function collectSourceFiles(directory) {
  const files = [];
  const visit = (currentDirectory) => {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
        visit(path.join(currentDirectory, entry.name));
        continue;
      }

      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      files.push(path.join(currentDirectory, entry.name));
    }
  };

  if (isDirectory(directory)) visit(directory);
  return files.sort();
}

function discoverUnits(rootDirectory, kind) {
  const parentDirectory = path.join(rootDirectory, kind);
  if (!isDirectory(parentDirectory)) return [];

  return readdirSync(parentDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const directory = path.join(parentDirectory, entry.name);
      const packageJsonPath = path.join(directory, 'package.json');
      const manifest = readManifest(packageJsonPath);
      return {
        kind,
        name: typeof manifest?.name === 'string' && manifest.name.length > 0 ? manifest.name : entry.name,
        directory,
        packageJsonPath: existsSync(packageJsonPath) ? packageJsonPath : null,
        manifest,
        sourceFiles: collectSourceFiles(directory),
      };
    });
}

function collectRootToolingSourceFiles(rootDirectory) {
  const rootConfigFiles = readdirSync(rootDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => path.join(rootDirectory, entry.name));
  const toolingFiles = ROOT_TOOLING_DIRECTORIES.flatMap((directory) => (
    collectSourceFiles(path.join(rootDirectory, directory))
  ));

  return [...new Set([...rootConfigFiles, ...toolingFiles])].sort();
}

function isWithin(targetPath, parentDirectory) {
  const relativePath = path.relative(parentDirectory, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isStringLiteral(node) {
  return node && node.type === 'Literal' && typeof node.value === 'string';
}

function memberPropertyName(node) {
  if (!node) return null;
  if (!node.computed && node.type === 'Identifier') return node.name;
  return isStringLiteral(node) ? node.value : null;
}

function unwrapTransparentExpression(node) {
  let current = node;
  while (
    current
    && (current.type === 'TSAsExpression'
      || current.type === 'TSTypeAssertion'
      || current.type === 'TSNonNullExpression'
      || current.type === 'ChainExpression')
  ) {
    current = current.expression;
  }
  return current;
}

function collectSourceDependencies(source, filePath) {
  const imports = [];
  const nonLiteralModuleLoads = [];
  const contractsBrowserGlobals = [];
  const seenImportNodes = new Set();
  const seenNonLiteralModuleLoads = new Set();
  const parsed = parser.parseForESLint(source, {
    filePath,
    jsx: /\.[cm]?tsx?$|\.[jt]sx$/i.test(filePath),
    loc: true,
    range: true,
    comment: false,
    sourceType: filePath.endsWith('.cjs') ? 'commonjs' : 'module',
    ecmaVersion: 'latest',
  });
  const ast = parsed.ast;
  const throughReferences = parsed.scopeManager?.globalScope?.through ?? [];
  const domGlobals = [];
  const seenDomReferences = new Set();
  const environmentReadCandidates = [];
  const seenEnvironmentReads = new Set();
  const seenContractsBrowserGlobals = new Set();
  const unresolvedProcessReferences = new Set(
    throughReferences
      .filter((reference) => reference.identifier?.name === 'process' && !reference.resolved)
      .map((reference) => reference.identifier.range?.join(':'))
      .filter(Boolean),
  );
  const unresolvedGlobalThisRanges = new Set(
    throughReferences
      .filter((reference) => reference.identifier?.name === 'globalThis' && !reference.resolved)
      .map((reference) => reference.identifier.range?.join(':'))
      .filter(Boolean),
  );
  const unresolvedRequireRanges = new Set(
    throughReferences
      .filter((reference) => reference.identifier?.name === 'require' && !reference.resolved)
      .map((reference) => reference.identifier.range?.join(':'))
      .filter(Boolean),
  );

  const isUnresolvedGlobalThis = (node) => {
    const current = unwrapTransparentExpression(node);
    if (!current || current.type !== 'Identifier' || current.name !== 'globalThis' || !current.range) return false;
    return unresolvedGlobalThisRanges.has(current.range.join(':'));
  };

  const addContractsBrowserGlobal = (node, value) => {
    if (!value || !CONTRACTS_BROWSER_ONLY_GLOBALS.has(value)) return;
    const line = node?.loc?.start?.line ?? 1;
    const key = node?.range ? `${node.range[0]}:${node.range[1]}` : `${line}:${value}`;
    if (seenContractsBrowserGlobals.has(key)) return;
    seenContractsBrowserGlobals.add(key);
    contractsBrowserGlobals.push({ module: value, line });
  };

  for (const reference of throughReferences.filter((reference) => !reference.resolved)) {
    const identifier = reference.identifier;
    if (identifier?.type === 'Identifier' && DOM_GLOBAL_IDENTIFIERS.has(identifier.name)) {
      const key = identifier.range
        ? `${identifier.range[0]}:${identifier.range[1]}`
        : `${identifier.loc?.start?.line ?? 1}:${identifier.loc?.start?.column ?? 0}:${identifier.name}`;
      if (seenDomReferences.has(key)) continue;
      seenDomReferences.add(key);
      domGlobals.push({ module: identifier.name, line: identifier.loc?.start?.line ?? 1 });
    }

    if (identifier?.type === 'Identifier') {
      addContractsBrowserGlobal(identifier, identifier.name);
    }
  }

  const add = (node, value) => {
    if (typeof value !== 'string' || value.length === 0) return;
    const line = node?.loc?.start?.line ?? 1;
    const key = node?.range ? `${node.range[0]}:${node.range[1]}` : `${line}:${value}`;
    if (seenImportNodes.has(key)) return;
    seenImportNodes.add(key);
    imports.push({ module: value, line });
  };

  const addNonLiteralModuleLoad = (node, module) => {
    const line = node?.loc?.start?.line ?? 1;
    const key = node?.range ? `${node.range[0]}:${node.range[1]}` : `${line}:${module}`;
    if (seenNonLiteralModuleLoads.has(key)) return;
    seenNonLiteralModuleLoads.add(key);
    nonLiteralModuleLoads.push({ module, line });
  };

  const isUnresolvedProcess = (node) => {
    const current = unwrapTransparentExpression(node);
    if (!current || current.type !== 'Identifier' || current.name !== 'process' || !current.range) return false;
    return unresolvedProcessReferences.has(current.range.join(':'));
  };

  const isProcessEnvMember = (node) => {
    const current = unwrapTransparentExpression(node);
    return current?.type === 'MemberExpression'
      && isUnresolvedProcess(current.object)
      && memberPropertyName(unwrapTransparentExpression(current.property)) === 'env';
  };

  const isImportMetaEnvMember = (node) => {
    const current = unwrapTransparentExpression(node);
    const object = unwrapTransparentExpression(current?.object);
    return current?.type === 'MemberExpression'
      && object?.type === 'MetaProperty'
      && object.meta?.name === 'import'
      && object.property?.name === 'meta'
      && memberPropertyName(unwrapTransparentExpression(current.property)) === 'env';
  };

  const isEnvironmentAccess = (node) => {
    const current = unwrapTransparentExpression(node);
    if (!current) return false;
    if (isProcessEnvMember(current) || isImportMetaEnvMember(current)) return true;
    return current.type === 'MemberExpression' && isEnvironmentAccess(current.object);
  };

  const addEnvironmentRead = (node) => {
    if (!node?.range) return;
    const key = node.range.join(':');
    if (seenEnvironmentReads.has(key)) return;
    seenEnvironmentReads.add(key);
    environmentReadCandidates.push({
      range: node.range,
      module: source.slice(node.range[0], node.range[1]),
      line: node.loc?.start?.line ?? 1,
    });
  };

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      if (isStringLiteral(node.source)) add(node.source, node.source.value);
    } else if (node.type === 'ImportExpression') {
      if (isStringLiteral(node.source)) add(node.source, node.source.value);
      else addNonLiteralModuleLoad(node.source ?? node, '<dynamic-import>');
    } else if (node.type === 'TSImportType' && isStringLiteral(node.source)) {
      add(node.source, node.source.value);
    } else if (
      node.type === 'TSImportEqualsDeclaration'
      && node.moduleReference?.type === 'TSExternalModuleReference'
      && isStringLiteral(node.moduleReference.expression)
    ) {
      add(node.moduleReference.expression, node.moduleReference.expression.value);
    } else if (
      node.type === 'CallExpression'
      && node.callee?.type === 'Identifier'
      && node.callee.name === 'require'
      && node.callee.range
      && unresolvedRequireRanges.has(node.callee.range.join(':'))
    ) {
      const [specifier] = node.arguments ?? [];
      if (node.arguments?.length === 1 && isStringLiteral(specifier) && specifier.value.length > 0) {
        add(specifier, specifier.value);
      } else {
        addNonLiteralModuleLoad(node, '<dynamic-require>');
      }
    } else if (
      (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
      && isUnresolvedGlobalThis(node.object)
    ) {
      addContractsBrowserGlobal(node.property, memberPropertyName(unwrapTransparentExpression(node.property)));
    }

    if (isEnvironmentAccess(node)) {
      addEnvironmentRead(node);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') continue;
      if (value && typeof value === 'object') visit(value);
    }
  };

  visit(ast);
  const environmentReads = environmentReadCandidates
    .filter((candidate, index, candidates) => !candidates.some((other, otherIndex) => {
      if (index === otherIndex) return false;
      return other.range[0] <= candidate.range[0]
        && other.range[1] >= candidate.range[1]
        && (other.range[0] < candidate.range[0] || other.range[1] > candidate.range[1]);
    }))
    .map(({ module, line }) => ({ module, line }));
  return { imports, nonLiteralModuleLoads, domGlobals, contractsBrowserGlobals, environmentReads };
}

function appTargetFromSpecifier(rootDirectory, moduleSpecifier, apps) {
  const appByDirectory = (targetPath) => apps.find((app) => isWithin(targetPath, app.directory)) ?? null;

  if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
    return (filePath) => appByDirectory(path.resolve(path.dirname(filePath), moduleSpecifier));
  }

  if (moduleSpecifier === 'apps' || moduleSpecifier.startsWith('apps/')) {
    return () => appByDirectory(path.resolve(rootDirectory, moduleSpecifier));
  }

  if (moduleSpecifier === '@' || moduleSpecifier.startsWith('@/')) {
    return (filePath) => {
      const sourceApp = appByDirectory(filePath);
      if (sourceApp) {
        const appLocalTarget = moduleSpecifier === '@'
          ? sourceApp.directory
          : path.resolve(sourceApp.directory, moduleSpecifier.slice(2));
        return appByDirectory(appLocalTarget);
      }
      if (moduleSpecifier === '@/apps' || moduleSpecifier.startsWith('@/apps/')) {
        return appByDirectory(path.resolve(rootDirectory, moduleSpecifier.slice(2)));
      }
      return null;
    };
  }

  const matchingApp = apps
    .filter((app) => moduleSpecifier === app.name || moduleSpecifier.startsWith(`${app.name}/`))
    .sort((left, right) => right.name.length - left.name.length)[0];
  return matchingApp ? () => matchingApp : () => null;
}

function rootAliasTargetFromSpecifier(rootDirectory, moduleSpecifier, aliases) {
  if (!aliases || typeof aliases !== 'object') return null;

  for (const [aliasPattern, targets] of Object.entries(aliases)) {
    if (!Array.isArray(targets) || typeof targets[0] !== 'string') continue;
    const starIndex = aliasPattern.indexOf('*');
    if (starIndex < 0) {
      if (moduleSpecifier === aliasPattern) return path.resolve(rootDirectory, targets[0]);
      continue;
    }

    const prefix = aliasPattern.slice(0, starIndex);
    const suffix = aliasPattern.slice(starIndex + 1);
    if (!moduleSpecifier.startsWith(prefix) || !moduleSpecifier.endsWith(suffix)) continue;
    const wildcard = moduleSpecifier.slice(prefix.length, moduleSpecifier.length - suffix.length);
    return path.resolve(rootDirectory, targets[0].replace('*', wildcard));
  }

  return null;
}

function rootToolingAppTargetFromSpecifier(rootDirectory, filePath, moduleSpecifier, apps, aliases) {
  const aliasTarget = rootAliasTargetFromSpecifier(rootDirectory, moduleSpecifier, aliases);
  if (aliasTarget) {
    return apps.find((app) => isWithin(aliasTarget, app.directory)) ?? null;
  }

  return appTargetFromSpecifier(rootDirectory, moduleSpecifier, apps)(filePath);
}

function packageTargetFromSpecifier(moduleSpecifier, packages) {
  return packages
    .filter((pkg) => moduleSpecifier === pkg.name || moduleSpecifier.startsWith(`${pkg.name}/`))
    .sort((left, right) => right.name.length - left.name.length)[0] ?? null;
}

function packageTargetFromRelativeSpecifier(filePath, moduleSpecifier, packages) {
  if (!moduleSpecifier.startsWith('./') && !moduleSpecifier.startsWith('../')) return null;

  const targetPath = path.resolve(path.dirname(filePath), moduleSpecifier);
  return packages.find((pkg) => isWithin(targetPath, pkg.directory)) ?? null;
}

function legacyRootAppTargetFromSpecifier(rootDirectory, filePath, moduleSpecifier, apps) {
  let targetPath;
  if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
    targetPath = path.resolve(path.dirname(filePath), moduleSpecifier);
  } else if (moduleSpecifier === '@' || moduleSpecifier.startsWith('@/')) {
    const sourceApp = apps.find((app) => isWithin(filePath, app.directory)) ?? null;
    targetPath = sourceApp
      ? path.resolve(sourceApp.directory, moduleSpecifier === '@' ? '.' : moduleSpecifier.slice(2))
      : path.resolve(rootDirectory, moduleSpecifier === '@' ? '.' : moduleSpecifier.slice(2));
  } else {
    return null;
  }

  const relativePath = path.relative(rootDirectory, targetPath);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  const topLevelDirectory = relativePath.split(path.sep)[0];
  return LEGACY_ROOT_APP_DIRECTORIES.has(topLevelDirectory) ? topLevelDirectory : null;
}

function isLegacyNextRouteSpecifier(rootDirectory, filePath, moduleSpecifier) {
  let targetPath;
  if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
    targetPath = path.resolve(path.dirname(filePath), moduleSpecifier);
  } else if (moduleSpecifier.startsWith('@/')) {
    targetPath = path.resolve(rootDirectory, moduleSpecifier.slice(2));
  } else {
    return false;
  }

  const relativePath = path.relative(rootDirectory, targetPath).split(path.sep).join('/');
  const pathSegments = relativePath.split('/');
  const routeRelativePath = pathSegments[0] === 'apps' && pathSegments[1]
    ? pathSegments.slice(2).join('/')
    : relativePath;

  return routeRelativePath === 'app/api'
    || routeRelativePath.startsWith('app/api/')
    || routeRelativePath === 'pages/api'
    || routeRelativePath.startsWith('pages/api/');
}

function localSourceTargetFromSpecifier(rootDirectory, filePath, moduleSpecifier) {
  let unresolvedTarget;
  if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
    unresolvedTarget = path.resolve(path.dirname(filePath), moduleSpecifier);
  } else if (moduleSpecifier.startsWith('@/')) {
    unresolvedTarget = path.resolve(rootDirectory, moduleSpecifier.slice(2));
  } else if (moduleSpecifier.startsWith('#/')) {
    const apiSourceDirectory = path.join(rootDirectory, 'apps', 'api', 'src');
    if (!isWithin(filePath, apiSourceDirectory)) return null;
    unresolvedTarget = path.resolve(apiSourceDirectory, moduleSpecifier.slice(2));
  } else {
    return null;
  }

  if (!isWithin(unresolvedTarget, rootDirectory)) return null;
  const extension = path.extname(unresolvedTarget);
  const candidates = extension
    ? [unresolvedTarget]
    : [
        ...Array.from(SOURCE_EXTENSIONS, (sourceExtension) => `${unresolvedTarget}${sourceExtension}`),
        ...Array.from(SOURCE_EXTENSIONS, (sourceExtension) => path.join(
          unresolvedTarget,
          `index${sourceExtension}`,
        )),
      ];
  return candidates.find((candidate) => isFile(candidate)) ?? null;
}

function packageSubpath(moduleSpecifier, packageName) {
  return moduleSpecifier === packageName ? null : `.${moduleSpecifier.slice(packageName.length)}`;
}

function exportKeys(exportsField) {
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) return [];
  const directKeys = Object.keys(exportsField).filter((key) => key.startsWith('.'));
  if (directKeys.length > 0) return directKeys;

  return Object.values(exportsField).flatMap((value) => exportKeys(value));
}

function matchesExportKey(exportKey, requestedSubpath) {
  if (exportKey === requestedSubpath) return true;
  const wildcardIndex = exportKey.indexOf('*');
  if (wildcardIndex < 0) return false;

  const prefix = exportKey.slice(0, wildcardIndex);
  const suffix = exportKey.slice(wildcardIndex + 1);
  return requestedSubpath.startsWith(prefix)
    && requestedSubpath.endsWith(suffix)
    && requestedSubpath.length >= prefix.length + suffix.length;
}

function isExportedSubpath(manifest, requestedSubpath) {
  return exportKeys(manifest?.exports).some((exportKey) => matchesExportKey(exportKey, requestedSubpath));
}

function isDomainPackage(unit) {
  return unit.kind === 'packages'
    && (path.basename(unit.directory) === 'domain' || unit.name.endsWith('/domain') || unit.name === 'domain');
}

function isClientPackage(unit) {
  if (unit.kind !== 'packages') return false;
  const directoryName = path.basename(unit.directory);
  const packageName = unit.name.split('/').at(-1) ?? unit.name;
  return CLIENT_PACKAGE_NAMES.has(directoryName) || CLIENT_PACKAGE_NAMES.has(packageName);
}

function isContractsPackage(unit) {
  if (unit.kind !== 'packages' || !unit.manifest) return false;
  const directoryName = path.basename(unit.directory);
  const packageName = unit.name.split('/').at(-1) ?? unit.name;
  return directoryName === 'contracts' || packageName === 'contracts';
}

/**
 * 共享 React DOM 包。
 *
 * 与 {@link isClientPackage} 一样同时接受目录名与包名末段：workspace 的 `name` 允许 scope，
 * 只按其中一种匹配会让改 scope 后规则静默失效——而一个静默失效的边界门禁比没有门禁更危险。
 */
function isSharedUiPackage(unit) {
  if (unit.kind !== 'packages') return false;
  const directoryName = path.basename(unit.directory);
  const packageName = unit.name.split('/').at(-1) ?? unit.name;
  return SHARED_UI_PACKAGE_NAMES.has(directoryName) || SHARED_UI_PACKAGE_NAMES.has(packageName);
}

function isContractsSourceFile(unit, sourceFile) {
  if (!isContractsPackage(unit)) return false;
  const relativeSource = path.relative(unit.directory, sourceFile);
  if (
    relativeSource === ''
    || relativeSource.startsWith('..')
    || path.isAbsolute(relativeSource)
  ) return false;
  const sourceFileName = path.basename(sourceFile).toLowerCase();
  if (CONTRACTS_EXCLUDED_SOURCE_SUFFIX.test(sourceFileName)) return false;
  return true;
}

export function generatedPublicPaths(rootDirectory) {
  const pathsByApp = new Map(Object.entries(CORE_GENERATED_PUBLIC_PATHS).map(([app, paths]) => [app, new Set(paths)]));
  const syncManifest = readManifest(path.join(rootDirectory, 'content', 'sync-manifest.json'));
  const sharedBrand = Array.isArray(syncManifest?.brand?.shared) ? syncManifest.brand.shared : [];
  const webBrand = Array.isArray(syncManifest?.brand?.web) ? syncManifest.brand.web : [];
  for (const name of sharedBrand) {
    pathsByApp.get('web')?.add(name);
    pathsByApp.get('desktop')?.add(name);
  }
  for (const name of webBrand) pathsByApp.get('web')?.add(name);
  return pathsByApp;
}

/**
 * MONO-006 的 fs 侧：生成物在干净检出上不存在，`readFileSync`、`new URL`、`path.join`
 * 之类的文件读取必须和静态 import 一样改走 `content/` 权威源。
 *
 * 规则拦截**字符串字面量**形态、指向生成物清单的 public 路径，覆盖真实写法：
 * - `apps/<app>/public/<生成物>`（仓库根相对）；
 * - `public/<生成物>`、`./public/<生成物>`（app 工作目录相对，如 `resolve(process.cwd(), …)`）。
 *
 * 刻意不拦截：
 * - `../public/…`、`@/public/…`：import specifier 形态，由 GENERATED-PUBLIC-IMPORT 管；
 * - `/questionnaires/…` 等无前缀路径：是运行时 URL 而非 fs 路径；
 * - `path.join('apps', 'web', 'public', …)` 分段拼装：生成器自身需要这种写法，
 *   动态逃逸面由 scripts/test-without-generated-public.mjs 的屏蔽运行兜底。
 */
const PUBLIC_FS_PATH_PATTERN = /^(?:apps\/(web|desktop)\/)?(?:\.\/)?public\/(.+)$/;
const QUOTED_LITERAL_PATTERN = /(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

/**
 * @param {Map<string, Set<string>>} pathsByApp
 * @returns {(appName: string | undefined, relativePath: string) => boolean}
 */
function generatedFsPathMatcher(pathsByApp) {
  const scopes = new Map(
    [...pathsByApp].map(([app, names]) => [app, new Set([...GENERATED_PUBLIC_ROOT_FILES, ...names])]),
  );
  return (appName, relativePath) => {
    const fileSets = appName ? [scopes.get(appName)] : [...scopes.values()];
    return fileSets.some((set) => set?.has(relativePath))
      || GENERATED_PUBLIC_DIRECTORIES.some((dir) => relativePath === dir || relativePath.startsWith(`${dir}/`));
  };
}

/**
 * 在剥除注释后的源码里扫字面量形态、命中生成物清单的 public fs 路径。
 * 块注释替换时保留换行，避免命中行的行号漂移。
 *
 * @param {string} source
 * @param {(appName: string | undefined, relativePath: string) => boolean} matchesGenerated
 * @returns {Array<{ path: string, line: number }>}
 */
function findGeneratedPublicFsReads(source, matchesGenerated) {
  const uncommented = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\/])\/\/[^\n]*/g, '$1');
  const hits = [];
  for (const match of uncommented.matchAll(QUOTED_LITERAL_PATTERN)) {
    const fsPath = PUBLIC_FS_PATH_PATTERN.exec(match[2]);
    if (!fsPath || !matchesGenerated(fsPath[1], fsPath[2])) continue;
    hits.push({ path: match[2], line: uncommented.slice(0, match.index).split('\n').length });
  }
  return hits;
}

/**
 * 生成物必须满足两条 Git 不变量：被 .gitignore 覆盖、且未留在索引里。
 *
 * `content/` 是权威源，`apps/<a>/public/` 副本由内容生成器在 dev/build 时重写。
 * tracked 副本允许「改了 content/ 但旧副本仍被提交、或直接改副本」的双源漂移；
 * 而 gitignore 对**已经 tracked** 的文件不生效——所以两条要分别用
 * `git check-ignore`（规则覆盖）与 `git ls-files`（索引残留）验证。
 *
 * 检查的根目录必须是 git worktree 根：fixture/临时根（`git rev-parse --show-toplevel`
 * 返回的是外层仓库或不成立）整组跳过，避免把宿主仓库的状态误记到 fixture 上。
 *
 * @param {string} rootDirectory
 * @param {Map<string, Set<string>>} pathsByApp
 * @returns {BoundaryViolation[]}
 */
function checkGeneratedPublicGitState(rootDirectory, pathsByApp) {
  let gitRoot;
  try {
    gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: rootDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return [];
  }
  if (!gitRoot || path.resolve(gitRoot) !== rootDirectory) return [];

  const violations = [];
  const git = (args) => spawnSync('git', args, { cwd: rootDirectory, encoding: 'utf8' });
  for (const [app, names] of pathsByApp) {
    const entries = [
      ...GENERATED_PUBLIC_DIRECTORIES.map((directory) => ({ path: directory, directory: true })),
      ...GENERATED_PUBLIC_ROOT_FILES.map((file) => ({ path: file, directory: false })),
      ...[...names].map((file) => ({ path: file, directory: false })),
    ];
    for (const entry of entries) {
      const relativeTarget = `apps/${app}/public/${entry.path}`;
      const ignoreProbe = entry.directory ? `${relativeTarget}/` : relativeTarget;
      if (git(['check-ignore', '-q', '--', ignoreProbe]).status !== 0) {
        violations.push({
          rule: 'MONO-006-GENERATED-PUBLIC-IGNORE',
          file: relativeTarget,
          module: '<gitignore>',
          message: 'generated public path lacks a .gitignore rule; generated copies must be ignored and recreated by the content generator',
        });
        continue;
      }
      if (git(['ls-files', '--', relativeTarget]).stdout.trim().length > 0) {
        violations.push({
          rule: 'MONO-006-GENERATED-PUBLIC-TRACKED',
          file: relativeTarget,
          module: '<git-index>',
          message: 'generated public copy is still git-tracked; remove it from the index (the canonical source lives under content/)',
        });
      }
    }
  }
  return violations;
}

function resolveLocalImportTarget(rootDirectory, sourceFile, moduleSpecifier, apps) {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0];
  let unresolvedTarget;
  if (cleanSpecifier.startsWith('./') || cleanSpecifier.startsWith('../')) {
    unresolvedTarget = path.resolve(path.dirname(sourceFile), cleanSpecifier);
  } else if (cleanSpecifier.startsWith('@/')) {
    const sourceApp = apps.find((app) => isWithin(sourceFile, app.directory));
    if (!sourceApp) return null;
    unresolvedTarget = path.resolve(sourceApp.directory, cleanSpecifier.slice(2));
  } else if (cleanSpecifier === 'apps' || cleanSpecifier.startsWith('apps/')) {
    unresolvedTarget = path.resolve(rootDirectory, cleanSpecifier);
  } else {
    return null;
  }

  return isWithin(unresolvedTarget, rootDirectory) ? unresolvedTarget : null;
}

function generatorOwnedPublicImport(rootDirectory, sourceFile, moduleSpecifier, apps, pathsByApp) {
  const target = resolveLocalImportTarget(rootDirectory, sourceFile, moduleSpecifier, apps);
  if (!target) return null;

  const relativeTarget = path.relative(rootDirectory, target).split(path.sep).join('/');
  const [, appName, publicDirectory, ...publicPathParts] = relativeTarget.split('/');
  if (relativeTarget.split('/')[0] !== 'apps' || publicDirectory !== 'public') return null;

  const publicPath = publicPathParts.join('/');
  // 生成器持有的内容分三层，import 拦截必须覆盖全部三层而不只是文件级清单：
  // GENERATED_PUBLIC_ROOT_FILES（languages.json/announcements.json 等共享根 JSON）、
  // GENERATED_PUBLIC_DIRECTORIES（encyclopedia/、questionnaires/presets/ 等整目录）、
  // 以及 pathsByApp 里按 app 登记的散文件（flowers.json、品牌资源）。只查文件级会漏掉
  // `public/questionnaires/presets/canshou-default.json` 这类"后迁入 content/ 的预设"——
  // 生成物在测试/lint 流程里并不存在，import 它会在干净检出上解析失败。
  if (GENERATED_PUBLIC_ROOT_FILES.includes(publicPath)) return publicPath;
  if (
    GENERATED_PUBLIC_DIRECTORIES.some(
      (directory) => publicPath === directory || publicPath.startsWith(`${directory}/`),
    )
  ) {
    return publicPath;
  }
  return pathsByApp.get(appName)?.has(publicPath) ? publicPath : null;
}

function addViolation(violations, rule, filePath, moduleSpecifier, message, line) {
  violations.push({
    rule,
    file: filePath.split(path.sep).join('/'),
    ...(line ? { line } : {}),
    module: moduleSpecifier,
    message,
  });
}

/**
 * Check every workspace unit. Retired legacy root directories remain a fail-closed
 * import target so a later change cannot silently recreate split app ownership.
 *
 * @param {string} rootDirectory
 * @returns {BoundaryViolation[]}
 */
export function checkWorkspaceBoundaries(rootDirectory = process.cwd()) {
  const normalizedRoot = path.resolve(rootDirectory);
  const apps = discoverUnits(normalizedRoot, 'apps');
  const packages = discoverUnits(normalizedRoot, 'packages');
  const units = [...apps, ...packages];
  const rootAliases = readManifest(path.join(normalizedRoot, 'tsconfig.json'))?.compilerOptions?.paths;
  const generatedPublicPathMap = generatedPublicPaths(normalizedRoot);
  const violations = checkGeneratedPublicGitState(normalizedRoot, generatedPublicPathMap);
  for (const unit of units) {
    if (!unit.manifest || !unit.packageJsonPath) continue;
    const scripts = unit.manifest.scripts;
    for (const scriptName of REQUIRED_WORKSPACE_SCRIPTS) {
      if (typeof scripts?.[scriptName] === 'string' && scripts[scriptName].trim().length > 0) continue;
      addViolation(
        violations,
        'MONO-002-MISSING-SCRIPT',
        unit.packageJsonPath,
        `${unit.name}:scripts.${scriptName}`,
        `workspace project must declare a non-empty ${scriptName} script`,
      );
    }
  }

  for (const pkg of packages) {
    if (!pkg.manifest || !Object.hasOwn(pkg.manifest, 'exports')) {
      addViolation(
        violations,
        'MONO-004-MISSING-EXPORTS',
        pkg.packageJsonPath ?? pkg.directory,
        pkg.name,
        'workspace package must declare an explicit exports map',
      );
    }
  }

  const rootToolingSourceFiles = collectRootToolingSourceFiles(normalizedRoot);
  for (const sourceFile of rootToolingSourceFiles) {
    let imports;
    try {
      ({ imports } = collectSourceDependencies(readFileSync(sourceFile, 'utf8'), sourceFile));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      addViolation(
        violations,
        'MONO-001-ROOT-TOOLING-PARSE',
        sourceFile,
        '<parse>',
        `cannot parse repository tooling source: ${reason}`,
      );
      continue;
    }

    for (const { module: moduleSpecifier, line } of imports) {
      const appTarget = rootToolingAppTargetFromSpecifier(
        normalizedRoot,
        sourceFile,
        moduleSpecifier,
        apps,
        rootAliases,
      );
      if (!appTarget) continue;

      addViolation(
        violations,
        'MONO-001-ROOT-APP-IMPORT',
        sourceFile,
        moduleSpecifier,
        `repository tooling must not import app ${appTarget.name} source`,
        line,
      );
    }
  }

  for (const unit of units) {
    for (const sourceFile of unit.sourceFiles) {
      let imports;
      let domGlobals;
      let contractsBrowserGlobals;
      let environmentReads;
      let nonLiteralModuleLoads;
      const contractsSourceFile = isContractsSourceFile(unit, sourceFile);
      try {
        ({
          imports,
          domGlobals,
          contractsBrowserGlobals,
          environmentReads,
          nonLiteralModuleLoads,
        } = collectSourceDependencies(readFileSync(sourceFile, 'utf8'), sourceFile));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        addViolation(violations, 'MONO-005-PARSE', sourceFile, '<parse>', `cannot parse source: ${reason}`);
        continue;
      }

      if (isDomainPackage(unit)) {
        for (const { module: domGlobal, line } of domGlobals) {
          addViolation(
            violations,
            'MONO-005-DOMAIN-DOM',
            sourceFile,
            domGlobal,
            'domain package must not reference browser DOM globals',
            line,
          );
        }
      }

      if (contractsSourceFile) {
        for (const { module: moduleSpecifier, line } of nonLiteralModuleLoads) {
          addViolation(
            violations,
            'MONO-005-CONTRACTS-DYNAMIC-MODULE',
            sourceFile,
            moduleSpecifier,
            'contracts package module specifiers must be statically analyzable',
            line,
          );
        }
      }

      if (isSharedUiPackage(unit)) {
        // 非字面量 `import(x)` 无法静态判定是否指向宿主 runtime。一条能被 `import(变量)` 绕过的
        // 边界规则不是门禁，所以共享 UI 直接禁掉这种写法——它的消费者都是同步 import，没有动态加载
        // 宿主模块的真实需求。
        for (const { module: moduleSpecifier, line } of nonLiteralModuleLoads) {
          addViolation(
            violations,
            'MONO-005-SHARED-UI-DYNAMIC-MODULE',
            sourceFile,
            moduleSpecifier,
            'shared UI package module specifiers must be statically analyzable so host runtime imports cannot hide behind a computed path',
            line,
          );
        }
      }

      if (contractsSourceFile) {
        for (const { module: browserGlobal, line } of contractsBrowserGlobals) {
          addViolation(
            violations,
            'MONO-005-CONTRACTS-BROWSER-GLOBAL',
            sourceFile,
            browserGlobal,
            'contracts package must not reference browser-only globals',
            line,
          );
        }
      }

      if (contractsSourceFile) {
        for (const { module: environmentRead, line } of environmentReads) {
          addViolation(
            violations,
            'MONO-005-CONTRACTS-ENV',
            sourceFile,
            environmentRead,
            'contracts package must not read runtime environment variables',
            line,
          );
        }
      }

      for (const { module: moduleSpecifier, line } of imports) {
        const generatedPublicPath = generatorOwnedPublicImport(
          normalizedRoot,
          sourceFile,
          moduleSpecifier,
          apps,
          generatedPublicPathMap,
        );
        if (generatedPublicPath) {
          addViolation(
            violations,
            'MONO-006-GENERATED-PUBLIC-IMPORT',
            sourceFile,
            moduleSpecifier,
            `business source must import generator-owned content from content/ instead of generated public/${generatedPublicPath}`,
            line,
          );
        }

        const appTarget = appTargetFromSpecifier(normalizedRoot, moduleSpecifier, apps)(sourceFile);
        if (appTarget && (unit.kind === 'packages' || appTarget.name !== unit.name)) {
          addViolation(
            violations,
            unit.kind === 'packages' ? 'MONO-005-PACKAGE-APP' : 'MONO-003',
            sourceFile,
            moduleSpecifier,
            unit.kind === 'packages'
              ? `package ${unit.name} must not import app ${appTarget.name}`
              : `app ${unit.name} must not import app ${appTarget.name}`,
            line,
          );
        }

        const legacyRootTarget = legacyRootAppTargetFromSpecifier(
          normalizedRoot,
          sourceFile,
          moduleSpecifier,
          apps,
        );
        if (legacyRootTarget) {
          addViolation(
            violations,
            unit.kind === 'packages' ? 'MONO-005-PACKAGE-LEGACY-APP' : 'MONO-003-LEGACY-APP',
            sourceFile,
            moduleSpecifier,
            unit.kind === 'packages'
              ? `package ${unit.name} must not import legacy root app directory ${legacyRootTarget}`
              : `app ${unit.name} must not import legacy root app directory ${legacyRootTarget}`,
            line,
          );
        }

        const relativePackageTarget = packageTargetFromRelativeSpecifier(sourceFile, moduleSpecifier, packages);
        if (relativePackageTarget && relativePackageTarget.directory !== unit.directory) {
          addViolation(
            violations,
            'MONO-004-DEEP-IMPORT',
            sourceFile,
            moduleSpecifier,
            `relative import enters workspace package ${relativePackageTarget.name}; use its exported package name instead`,
            line,
          );
        }

        if (isDomainPackage(unit) && (NODE_RUNTIME_MODULE.test(moduleSpecifier) || FRAMEWORK_RUNTIME_MODULE.test(moduleSpecifier))) {
          addViolation(
            violations,
            'MONO-005-DOMAIN-RUNTIME',
            sourceFile,
            moduleSpecifier,
            'domain package must remain independent from framework, runtime, DOM, and database modules',
            line,
          );
        }

        if (isClientPackage(unit) && SECRET_MODULE_SEGMENT.test(moduleSpecifier)) {
          addViolation(
            violations,
            'MONO-005-CLIENT-SECRET',
            sourceFile,
            moduleSpecifier,
            'client package must not import server secret, signature, environment, or private modules',
            line,
          );
        }

        if (isSharedUiPackage(unit) && isSharedUiForbiddenRuntime(moduleSpecifier)) {
          addViolation(
            violations,
            'MONO-005-SHARED-UI-RUNTIME',
            sourceFile,
            moduleSpecifier,
            'shared UI package must stay host-neutral: it must not import Next, Tauri, server runtime, Node builtins, or database clients',
            line,
          );
        }

        const targetPackage = packageTargetFromSpecifier(moduleSpecifier, packages);
        const requestedSubpath = targetPackage ? packageSubpath(moduleSpecifier, targetPackage.name) : null;
        if (targetPackage && requestedSubpath && !isExportedSubpath(targetPackage.manifest, requestedSubpath)) {
          addViolation(
            violations,
            'MONO-004-DEEP-IMPORT',
            sourceFile,
            moduleSpecifier,
            `package subpath ${requestedSubpath} is not declared by ${targetPackage.name}.exports`,
            line,
          );
        }

        if (
          contractsSourceFile
          && (NODE_RUNTIME_MODULE.test(moduleSpecifier) || FRAMEWORK_RUNTIME_MODULE.test(moduleSpecifier))
        ) {
          addViolation(
            violations,
            'MONO-005-CONTRACTS-RUNTIME',
            sourceFile,
            moduleSpecifier,
            'contracts package must remain independent from framework, runtime, and database modules',
            line,
          );
        }
      }
    }
  }

  // fs 侧生成物读取：静态 import 规则管不到 readFileSync 这类调用，对测试/工具里
  // 的字面量 public 路径做统一扫描（单元源码与根工具文件同一集合）。
  const matchesGeneratedFsPath = generatedFsPathMatcher(generatedPublicPathMap);
  const fsScannedFiles = new Set(rootToolingSourceFiles);
  for (const unit of units) {
    for (const sourceFile of unit.sourceFiles) fsScannedFiles.add(sourceFile);
  }
  for (const sourceFile of fsScannedFiles) {
    for (const hit of findGeneratedPublicFsReads(readFileSync(sourceFile, 'utf8'), matchesGeneratedFsPath)) {
      addViolation(
        violations,
        'MONO-006-GENERATED-PUBLIC-READ',
        sourceFile,
        hit.path,
        'generator-owned public copies do not exist on a clean checkout; read the authority under content/ instead',
        hit.line,
      );
    }
  }

  const honoAdapterDirectory = path.join(
    normalizedRoot,
    'apps',
    'api',
    'src',
    'adapters',
  );
  const visitedHonoDependencies = new Set();
  const inspectHonoDependency = (sourceFile) => {
    if (visitedHonoDependencies.has(sourceFile)) return;
    visitedHonoDependencies.add(sourceFile);

    let imports;
    let nonLiteralModuleLoads;
    try {
      ({ imports, nonLiteralModuleLoads } = collectSourceDependencies(
        readFileSync(sourceFile, 'utf8'),
        sourceFile,
      ));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      addViolation(
        violations,
        'MONO-009-HONO-ADAPTER-PARSE',
        sourceFile,
        '<parse>',
        `cannot parse Hono adapter source: ${reason}`,
      );
      return;
    }

    for (const { module: moduleSpecifier, line } of nonLiteralModuleLoads) {
      addViolation(
        violations,
        'MONO-009-HONO-ADAPTER-DYNAMIC',
        sourceFile,
        moduleSpecifier,
        'Hono shared adapter dependency graph must use statically analyzable module specifiers',
        line,
      );
    }

    for (const { module: moduleSpecifier, line } of imports) {
      if (isLegacyNextRouteSpecifier(normalizedRoot, sourceFile, moduleSpecifier)) {
        addViolation(
          violations,
          'MONO-009-HONO-ADAPTER-LEGACY',
          sourceFile,
          moduleSpecifier,
          'Hono shared adapter must depend on a shared service composition, not legacy Next route source',
          line,
        );
        continue;
      }

      const targetSource = localSourceTargetFromSpecifier(
        normalizedRoot,
        sourceFile,
        moduleSpecifier,
      );
      if (targetSource) inspectHonoDependency(targetSource);
    }
  };

  for (const sourceFile of collectSourceFiles(honoAdapterDirectory)) {
    inspectHonoDependency(sourceFile);
  }

  return violations.sort((left, right) => {
    const fileOrder = left.file.localeCompare(right.file);
    if (fileOrder !== 0) return fileOrder;
    const lineOrder = (left.line ?? 0) - (right.line ?? 0);
    if (lineOrder !== 0) return lineOrder;
    const ruleOrder = left.rule.localeCompare(right.rule);
    if (ruleOrder !== 0) return ruleOrder;
    return left.module.localeCompare(right.module);
  });
}

/**
 * @param {BoundaryViolation[]} violations
 * @param {string} rootDirectory
 */
export function formatBoundaryViolations(violations, rootDirectory = process.cwd()) {
  return violations.map((violation) => {
    const relativeFile = (path.relative(path.resolve(rootDirectory), violation.file) || path.basename(violation.file)).split(path.sep).join('/');
    const location = violation.line ? `:${violation.line}` : '';
    return `[${violation.rule}] ${relativeFile}${location} -> ${violation.module}: ${violation.message}`;
  }).join('\n');
}

function parseRootArgument(argv) {
  const rootIndex = argv.indexOf('--root');
  if (rootIndex >= 0 && argv[rootIndex + 1]) return path.resolve(argv[rootIndex + 1]);

  const inlineRoot = argv.find((argument) => argument.startsWith('--root='));
  if (inlineRoot) return path.resolve(inlineRoot.slice('--root='.length));
  return process.cwd();
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile && pathToFileURL(invokedFile).href === pathToFileURL(currentFile).href) {
  const rootDirectory = parseRootArgument(process.argv.slice(2));
  const violations = checkWorkspaceBoundaries(rootDirectory);
  if (violations.length > 0) {
    console.error(`workspace boundary check failed (${violations.length} violation${violations.length === 1 ? '' : 's'})`);
    console.error(formatBoundaryViolations(violations, rootDirectory));
    process.exitCode = 1;
  } else {
    console.log(`workspace boundary check passed: ${path.relative(process.cwd(), rootDirectory) || '.'}`);
  }
}
