import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseJsonc } from 'comment-json';
import { parse as parseYaml } from 'yaml';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminDirectory = path.join(rootDirectory, 'apps/admin');

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const walkFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolutePath = path.join(directory, entry.name);
  if (entry.isDirectory()) {
    if (['dist', 'node_modules', '.wrangler', 'coverage'].includes(entry.name)) return [];
    return walkFiles(absolutePath);
  }
  return entry.isFile() ? [absolutePath] : [];
});

const FORBIDDEN_IMPORT_PATTERN = /(?:from\s+|import\s*\()["'](?:@mahoshojo\/(?:web|api|d1-gateway)(?:\/[^"']*)?|[^"']*(?:apps\/(?:web|api|d1-gateway)|(?:\.\.\/)+(?:web|api|d1-gateway))(?:\/[^"']*)?)["']/;

export const validateAdminSourceImports = (source, sourcePath) => (
  FORBIDDEN_IMPORT_PATTERN.test(source) ? [`${sourcePath} 跨 app 源码导入`] : []
);

const ALLOWED_WRANGLER_KEYS = new Set([
  '$schema',
  'name',
  'main',
  'compatibility_date',
  'compatibility_flags',
  'workers_dev',
  'vars',
  'observability',
]);

const DENY_ALL_VARS = Object.freeze({
  ADMIN_ACCESS_ISSUER: 'https://unconfigured.cloudflareaccess.invalid',
  ADMIN_ACCESS_AUDIENCE: 'UNCONFIGURED_DENY_ALL',
  ADMIN_ACCESS_JWKS_URL: 'https://unconfigured.cloudflareaccess.invalid/cdn-cgi/access/certs',
  ADMIN_PRINCIPALS_JSON: '[]',
});

const EXPECTED_ADMIN_SCRIPTS = Object.freeze({
  dev: 'wrangler dev',
  types: 'wrangler types --include-runtime false --env-interface CloudflareBindings src/worker-configuration.d.ts',
  test: 'vitest run --config vitest.config.ts',
  lint: 'eslint src tests --config eslint.config.mjs',
  build: 'wrangler types --check --include-runtime false --env-interface CloudflareBindings src/worker-configuration.d.ts && tsc --noEmit -p tsconfig.json && wrangler deploy --dry-run --outdir dist && node ../../scripts/check-admin-security-boundary.mjs',
  deploy: 'wrangler deploy',
});

export const validateAdminWranglerConfig = (source) => {
  let config;
  try {
    config = parseJsonc(source);
  } catch {
    return ['Wrangler config 不是有效 JSONC'];
  }
  if (!isRecord(config)) return ['Wrangler config 顶层必须是 object'];

  const failures = [];
  const unexpectedKeys = Object.keys(config).filter((key) => !ALLOWED_WRANGLER_KEYS.has(key)).sort();
  if (unexpectedKeys.length > 0) {
    failures.push(`Wrangler config 包含未允许的顶层键: ${unexpectedKeys.join(', ')}`);
  }
  if (config.workers_dev !== false) failures.push('apps/admin/wrangler.jsonc 必须保持 workers_dev=false');
  if (config.main !== 'src/index.ts') failures.push('Wrangler main 必须保持 server-only src/index.ts');
  if (!Array.isArray(config.compatibility_flags) || !config.compatibility_flags.includes('nodejs_compat')) {
    failures.push('Wrangler config 必须显式启用 nodejs_compat');
  }
  if (!isRecord(config.vars)) {
    failures.push('G3-P0 Wrangler vars 必须是 deny-all object');
  } else {
    const actualVarKeys = Object.keys(config.vars).sort();
    const expectedVarKeys = Object.keys(DENY_ALL_VARS).sort();
    if (
      actualVarKeys.length !== expectedVarKeys.length
      || actualVarKeys.some((key, index) => key !== expectedVarKeys[index])
      || expectedVarKeys.some((key) => config.vars[key] !== DENY_ALL_VARS[key])
    ) {
      failures.push('G3-P0 Wrangler vars 必须精确保持 deny-all placeholder');
    }
  }
  return failures;
};

export const validateAdminPackageManifest = (source) => {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    return ['apps/admin/package.json 不是有效 JSON'];
  }
  if (!isRecord(manifest) || manifest.name !== '@mahoshojo/admin' || !isRecord(manifest.scripts)) {
    return ['apps/admin/package.json 必须声明 scripts'];
  }
  const actualKeys = Object.keys(manifest.scripts).sort();
  const expectedKeys = Object.keys(EXPECTED_ADMIN_SCRIPTS).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index])
    && expectedKeys.every((key) => manifest.scripts[key] === EXPECTED_ADMIN_SCRIPTS[key])
    ? []
    : ['apps/admin scripts 必须精确保持受审查的 dev/types/test/lint/build/deploy 集合，禁止 lifecycle/alias 漂移'];
};

const ADMIN_WORKFLOW_REFERENCE = /(?:^|[^a-z0-9])(?:apps[\\/]admin|@mahoshojo[\\/]admin|admin)(?:[^a-z0-9]|$)/i;
const containsAdminWorkflowReference = (value) => {
  if (typeof value === 'string') return ADMIN_WORKFLOW_REFERENCE.test(value);
  if (Array.isArray(value)) return value.some(containsAdminWorkflowReference);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => (
    ADMIN_WORKFLOW_REFERENCE.test(key) || containsAdminWorkflowReference(child)
  ));
};

export const isAdminBrowserArtifactPath = (artifactPath) => {
  const normalized = artifactPath.replaceAll('\\', '/').toLowerCase();
  return /\.(?:html?|css|svg|png|jpe?g|gif|webp|wasm)$/.test(normalized)
    || /(?:^|\/)(?:(?:client|browser)[^/]*|public(?:[._/-]|$)|assets(?:[._/-]|$))/.test(normalized);
};

export const validateAdminWorkflow = (source, workflowPath) => {
  let workflow;
  try {
    workflow = parseYaml(source);
  } catch {
    return [`${workflowPath} 不是有效 workflow YAML`];
  }
  if (!isRecord(workflow)) return [];
  return containsAdminWorkflowReference(workflow)
    ? [`${workflowPath} G3-P0 workflow 不得直接引用 Admin；请使用 root workspace orchestration`]
    : [];
};

const run = () => {
  const failures = [];
  const fail = (message) => failures.push(message);
  const relative = (absolutePath) => path.relative(rootDirectory, absolutePath);

  const adminFiles = walkFiles(adminDirectory);
  const sourceFiles = adminFiles.filter((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file));
  const textFiles = adminFiles.filter((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|ya?ml)$/.test(file));
  const browserEntrypoints = adminFiles.filter((file) => /(?:^|\/)(?:public|client|browser)(?:\/|$)/.test(file));

  if (browserEntrypoints.length > 0) {
    fail(`G3-P0 不应产生浏览器 bundle/client entry: ${browserEntrypoints.map(relative).join(', ')}`);
  }

  const forbiddenCredentialPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bsk_(?:live|prod)_[A-Za-z0-9_-]{16,}\b/,
    /\b(?:postgres|mysql):\/\/[^\s:@/]+:[^\s@/]+@/i,
    /\bCLOUDFLARE_API_TOKEN\s*=\s*[^\s"']+/,
  ];

  for (const file of sourceFiles) {
    for (const failure of validateAdminSourceImports(readFileSync(file, 'utf8'), relative(file))) fail(failure);
  }
  for (const file of textFiles) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of forbiddenCredentialPatterns) {
      if (pattern.test(source)) fail(`${relative(file)} 命中 credential/private-key pattern ${pattern}`);
    }
  }

  const wranglerPath = path.join(adminDirectory, 'wrangler.jsonc');
  for (const failure of validateAdminWranglerConfig(readFileSync(wranglerPath, 'utf8'))) fail(failure);
  const packageManifestPath = path.join(adminDirectory, 'package.json');
  for (const failure of validateAdminPackageManifest(readFileSync(packageManifestPath, 'utf8'))) fail(failure);

  const artifactDirectory = path.join(adminDirectory, 'dist');
  if (existsSync(artifactDirectory)) {
    const artifactFiles = walkFiles(artifactDirectory);
    const browserArtifacts = artifactFiles.filter(isAdminBrowserArtifactPath);
    if (browserArtifacts.length > 0) {
      fail(`G3-P0 dist 不得包含 browser/static artifact: ${browserArtifacts.map(relative).join(', ')}`);
    }
    for (const file of artifactFiles.filter((candidate) => /\.(?:js|mjs|cjs|json|map|html?|css|svg|txt)$/i.test(candidate))) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbiddenCredentialPatterns) {
        if (pattern.test(source)) fail(`${relative(file)} 命中 credential/private-key pattern ${pattern}`);
      }
    }
  }

  const workflowDirectory = path.join(rootDirectory, '.github/workflows');
  if (existsSync(workflowDirectory)) {
    for (const workflow of walkFiles(workflowDirectory).filter((file) => /\.ya?ml$/.test(file))) {
      for (const failure of validateAdminWorkflow(readFileSync(workflow, 'utf8'), relative(workflow))) fail(failure);
    }
  }

  if (failures.length > 0) {
    console.error('Admin security boundary check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Admin security boundary check passed (${adminFiles.length} files, no browser bundle/production route/cross-app import/credential material)`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
