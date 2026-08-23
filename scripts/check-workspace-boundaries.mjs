import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import parser from '@typescript-eslint/parser';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const IGNORED_DIRECTORIES = new Set(['.git', '.next', '.open-next', 'build', 'coverage', 'dist', 'node_modules', 'out']);
const CLIENT_PACKAGE_NAMES = new Set(['ai-direct', 'local-library', 'cloud-client', 'ui-web']);
const REQUIRED_WORKSPACE_SCRIPTS = ['test', 'lint', 'build'];
const LEGACY_ROOT_APP_DIRECTORIES = new Set([
  'app',
  'components',
  'config',
  'drizzle',
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

const NODE_RUNTIME_MODULE = /^(?:node:|assert(?:\/|$)|buffer(?:\/|$)|child_process(?:\/|$)|cluster(?:\/|$)|crypto(?:\/|$)|dgram(?:\/|$)|dns(?:\/|$)|events(?:\/|$)|fs(?:\/|$)|http(?:\/|$)|https(?:\/|$)|module(?:\/|$)|net(?:\/|$)|os(?:\/|$)|path(?:\/|$)|perf_hooks(?:\/|$)|process(?:\/|$)|readline(?:\/|$)|stream(?:\/|$)|string_decoder(?:\/|$)|timers(?:\/|$)|tls(?:\/|$)|tty(?:\/|$)|url(?:\/|$)|util(?:\/|$)|v8(?:\/|$)|vm(?:\/|$)|worker_threads(?:\/|$)|zlib(?:\/|$))/;
const FRAMEWORK_RUNTIME_MODULE = /^(?:next(?:\/|$)|react(?:\/|$)|react-dom(?:\/|$)|hono(?:\/|$)|@hono\/(?:.+)|wrangler(?:\/|$)|cloudflare:.+|cloudflare(?:\/|$)|@cloudflare\/(?:.+)|@opennextjs\/(?:.+)|@tauri\/(?:.+)|@tauri-apps\/(?:.+)|tauri(?:\/|$)|electron(?:\/|$)|@electron\/(?:.+)|drizzle-orm(?:\/|$)|better-sqlite3(?:\/|$)|kysely(?:\/|$)|redis(?:\/|$)|ioredis(?:\/|$)|pg(?:\/|$)|mysql2(?:\/|$)|sqlite3(?:\/|$)|@libsql\/(?:.+)|idb(?:\/|$)|indexeddb(?:\/|$))/;
const SECRET_MODULE_SEGMENT = /(^|[\\/_.-])(server|secret|secrets|signature|signatures|env|environment|environments|private)(?=$|[\\/_.-])/i;

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
  const seenImportNodes = new Set();
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
  const domGlobals = [];
  const seenDomReferences = new Set();
  const environmentReadCandidates = [];
  const seenEnvironmentReads = new Set();
  const unresolvedProcessReferences = new Set(
    (parsed.scopeManager?.globalScope?.through ?? [])
      .filter((reference) => reference.identifier?.name === 'process' && !reference.resolved)
      .map((reference) => reference.identifier.range?.join(':'))
      .filter(Boolean),
  );
  for (const reference of parsed.scopeManager?.globalScope?.through ?? []) {
    const identifier = reference.identifier;
    if (!identifier || identifier.type !== 'Identifier' || !DOM_GLOBAL_IDENTIFIERS.has(identifier.name)) continue;
    const key = identifier.range
      ? `${identifier.range[0]}:${identifier.range[1]}`
      : `${identifier.loc?.start?.line ?? 1}:${identifier.loc?.start?.column ?? 0}:${identifier.name}`;
    if (seenDomReferences.has(key)) continue;
    seenDomReferences.add(key);
    domGlobals.push({ module: identifier.name, line: identifier.loc?.start?.line ?? 1 });
  }

  const add = (node, value) => {
    if (typeof value !== 'string' || value.length === 0) return;
    const line = node?.loc?.start?.line ?? 1;
    const key = node?.range ? `${node.range[0]}:${node.range[1]}` : `${line}:${value}`;
    if (seenImportNodes.has(key)) return;
    seenImportNodes.add(key);
    imports.push({ module: value, line });
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
    } else if (node.type === 'ImportExpression' && isStringLiteral(node.source)) {
      add(node.source, node.source.value);
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
      && isStringLiteral(node.arguments?.[0])
    ) {
      add(node.arguments[0], node.arguments[0].value);
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
  return { imports, domGlobals, environmentReads };
}

function appTargetFromSpecifier(rootDirectory, moduleSpecifier, apps) {
  const appByDirectory = (targetPath) => apps.find((app) => isWithin(targetPath, app.directory)) ?? null;

  if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
    return (filePath) => appByDirectory(path.resolve(path.dirname(filePath), moduleSpecifier));
  }

  if (moduleSpecifier === 'apps' || moduleSpecifier.startsWith('apps/')) {
    return () => appByDirectory(path.resolve(rootDirectory, moduleSpecifier));
  }

  if (moduleSpecifier === '@/apps' || moduleSpecifier.startsWith('@/apps/')) {
    return () => appByDirectory(path.resolve(rootDirectory, moduleSpecifier.slice(2)));
  }

  const matchingApp = apps
    .filter((app) => moduleSpecifier === app.name || moduleSpecifier.startsWith(`${app.name}/`))
    .sort((left, right) => right.name.length - left.name.length)[0];
  return matchingApp ? () => matchingApp : () => null;
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

function legacyRootAppTargetFromSpecifier(rootDirectory, filePath, moduleSpecifier) {
  let targetPath;
  if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
    targetPath = path.resolve(path.dirname(filePath), moduleSpecifier);
  } else if (moduleSpecifier === '@' || moduleSpecifier.startsWith('@/')) {
    targetPath = path.resolve(rootDirectory, moduleSpecifier === '@' ? '.' : moduleSpecifier.slice(2));
  } else {
    return null;
  }

  const relativePath = path.relative(rootDirectory, targetPath);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  const topLevelDirectory = relativePath.split(path.sep)[0];
  return LEGACY_ROOT_APP_DIRECTORIES.has(topLevelDirectory) ? topLevelDirectory : null;
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

function addViolation(violations, rule, filePath, moduleSpecifier, message, line) {
  violations.push({
    rule,
    file: filePath,
    ...(line ? { line } : {}),
    module: moduleSpecifier,
    message,
  });
}

/**
 * Check only future workspace units. The legacy root app is intentionally outside
 * the scan so this guard can be enabled before root sources are migrated.
 *
 * @param {string} rootDirectory
 * @returns {BoundaryViolation[]}
 */
export function checkWorkspaceBoundaries(rootDirectory = process.cwd()) {
  const normalizedRoot = path.resolve(rootDirectory);
  const apps = discoverUnits(normalizedRoot, 'apps');
  const packages = discoverUnits(normalizedRoot, 'packages');
  const units = [...apps, ...packages];
  const violations = [];
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

  for (const unit of units) {
    for (const sourceFile of unit.sourceFiles) {
      let imports;
      let domGlobals;
      let environmentReads;
      try {
        ({ imports, domGlobals, environmentReads } = collectSourceDependencies(readFileSync(sourceFile, 'utf8'), sourceFile));
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

      if (isContractsPackage(unit)) {
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

        if (unit.kind === 'packages') {
          const legacyRootTarget = legacyRootAppTargetFromSpecifier(
            normalizedRoot,
            sourceFile,
            moduleSpecifier,
          );
          if (legacyRootTarget) {
            addViolation(
              violations,
              'MONO-005-PACKAGE-LEGACY-APP',
              sourceFile,
              moduleSpecifier,
              `package ${unit.name} must not import legacy root app directory ${legacyRootTarget}`,
              line,
            );
          }
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
      }
    }
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
    const relativeFile = path.relative(path.resolve(rootDirectory), violation.file) || path.basename(violation.file);
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
