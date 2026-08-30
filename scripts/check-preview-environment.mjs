import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parse } from 'comment-json';

const SCRIPT_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const WRANGLER_PATH = resolve(REPOSITORY_ROOT, 'apps/web/wrangler.jsonc');
const WORKFLOW_PATH = resolve(REPOSITORY_ROOT, '.github/workflows/preview-deploy.yml');
const ENVIRONMENT_PATH = resolve(REPOSITORY_ROOT, 'config/preview-environment.json');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_REDIS_PREFIX_PATTERN = /^[a-z0-9_-]{1,32}$/u;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'));

const readWrangler = () => parse(readFileSync(WRANGLER_PATH, 'utf8'), undefined, true);

const readD1Entries = (config) => {
  const entries = [];
  const append = (section, value) => {
    if (!Array.isArray(value)) return;
    for (const entry of value) entries.push({ section, entry });
  };
  append('d1_databases', config?.d1_databases);
  if (isObject(config?.env)) {
    for (const [environment, value] of Object.entries(config.env)) {
      if (isObject(value)) append(`env.${environment}.d1_databases`, value.d1_databases);
    }
  }
  return entries;
};

const environmentValue = (env, name) => env?.[name]?.trim() ?? '';

export const validatePreviewEnvironment = ({
  environment,
  env = process.env,
  requireProvisioned = false,
  workflow,
  wrangler,
}) => {
  const issues = [];
  const entries = readD1Entries(wrangler);
  const productionIds = new Set(
    entries
      .filter(({ section }) => section === 'd1_databases' || section === 'env.production.d1_databases')
      .map(({ entry }) => entry?.database_id)
      .filter((id) => typeof id === 'string' && UUID_PATTERN.test(id)),
  );
  const previewEntries = entries.filter(({ section }) => section === 'env.preview.d1_databases');

  if (environment?.schemaVersion !== 2) issues.push('preview environment schemaVersion 必须为 2');
  if (environment?.environment !== 'preview') issues.push('preview environment 必须声明 environment=preview');
  if (!['not-provisioned', 'provisioned'].includes(environment?.status)) {
    issues.push('preview environment status 必须为 not-provisioned 或 provisioned');
  }
  if (environment?.activation !== 'fail-closed') issues.push('preview activation 必须为 fail-closed');

  for (const resource of ['d1', 'r2', 'runtimeConfig', 'secrets']) {
    if (typeof environment?.resources?.[resource] !== 'string') {
      issues.push(`preview resources.${resource} 未声明`);
    }
  }
  if (environment?.resources?.d1 !== 'shared-production') {
    issues.push('preview D1 必须明确声明 shared-production 模式');
  }
  if (environment?.resources?.redis !== 'shared-prefix') {
    issues.push('preview Redis 必须明确声明 shared-prefix 逻辑隔离模式');
  }
  if (environment?.redisIsolation?.mode !== 'shared-network-logical-prefix') {
    issues.push('preview Redis isolation mode 必须声明 shared-network-logical-prefix');
  }
  if (environment?.redisIsolation?.requiredKeyPrefix !== 'preview') {
    issues.push('preview Redis 必须使用 preview key prefix');
  }
  if (previewEntries.length !== 1) issues.push('preview 必须声明一个 production-shared D1 binding');
  for (const { entry } of previewEntries) {
    const databaseId = entry?.database_id;
    if (typeof databaseId !== 'string' || !UUID_PATTERN.test(databaseId)) {
      issues.push('preview D1 database_id 必须是合法 UUID');
    } else if (!productionIds.has(databaseId)) {
      issues.push('preview D1 必须复用 production database_id');
    }
  }

  if (typeof workflow !== 'string' || workflow.length === 0) {
    issues.push('preview workflow 为空');
  } else {
    if (/VPS_USER:\s*root\b/u.test(workflow)) issues.push('preview workflow 禁止使用 root SSH 用户');
    if (workflow.includes('secrets.VPS_SSH_PRIVATE_KEY')) {
      issues.push('preview workflow 禁止复用 production VPS_SSH_PRIVATE_KEY');
    }
    if (/VPS_HOST:\s*38\.76\.205\.9/u.test(workflow)) {
      issues.push('preview workflow 不得硬编码 production VPS host');
    }
    for (const marker of [
      'PREVIEW_VPS_HOST',
      'PREVIEW_VPS_USER',
      'PREVIEW_VPS_SSH_PRIVATE_KEY',
      'PREVIEW_VPS_HOST_KEY',
      'PREVIEW_REDIS_NETWORK_NAME',
      'check:preview:environment -- --require-provisioned',
    ]) {
      if (!workflow.includes(marker)) issues.push(`preview workflow 缺少 ${marker}`);
    }
  }

  if (requireProvisioned) {
    if (environment?.status !== 'provisioned') {
      issues.push('preview deployment 要求 status=provisioned；当前未完成资源纳管');
    }
    const requiredInputs = [
      'PREVIEW_D1_DATABASE_ID',
      'PREVIEW_VPS_HOST',
      'PREVIEW_VPS_USER',
      'PREVIEW_VPS_HOST_KEY',
      'PREVIEW_VPS_SSH_PRIVATE_KEY',
      'PREVIEW_REDIS_NETWORK_NAME',
      'PREVIEW_REDIS_KEY_PREFIX',
      'PREVIEW_DATA_ENVIRONMENT',
      'PREVIEW_REDIS_ISOLATION',
      'PREVIEW_ENV_FILE_PATH',
    ];
    for (const name of requiredInputs) {
      if (!environmentValue(env, name)) issues.push(`${name} 未提供`);
    }
    const previewDatabaseId = environmentValue(env, 'PREVIEW_D1_DATABASE_ID');
    const configuredPreviewId = previewEntries[0]?.entry?.database_id;
    if (previewDatabaseId && previewDatabaseId !== configuredPreviewId) {
      issues.push('PREVIEW_D1_DATABASE_ID 与 wrangler preview binding 不一致');
    }
    if (previewDatabaseId && !productionIds.has(previewDatabaseId)) {
      issues.push('PREVIEW_D1_DATABASE_ID 必须指向 production D1');
    }
    if (environmentValue(env, 'PREVIEW_VPS_USER') === 'root') {
      issues.push('PREVIEW_VPS_USER 不得为 root');
    }
    if (environmentValue(env, 'PREVIEW_REDIS_KEY_PREFIX') !== 'preview') {
      issues.push('PREVIEW_REDIS_KEY_PREFIX 必须为 preview');
    }
    if (environmentValue(env, 'PREVIEW_DATA_ENVIRONMENT') !== 'shared-production') {
      issues.push('PREVIEW_DATA_ENVIRONMENT 必须为 shared-production');
    }
    if (environmentValue(env, 'PREVIEW_REDIS_ISOLATION') !== 'prefix') {
      issues.push('PREVIEW_REDIS_ISOLATION 必须为 prefix');
    }
    const envFilePath = environmentValue(env, 'PREVIEW_ENV_FILE_PATH');
    if (envFilePath && (!envFilePath.startsWith('/') || !envFilePath.endsWith('/.env.hono'))) {
      issues.push('PREVIEW_ENV_FILE_PATH 必须是绝对路径下的专用 .env.hono');
    }
    if (envFilePath === '/opt/mahoshojo-hono/.env.hono') {
      issues.push('PREVIEW_ENV_FILE_PATH 不得指向 production .env.hono');
    }
  }

  return issues;
};

export const main = ({ argv = process.argv.slice(2), env = process.env } = {}) => {
  const requireProvisioned = argv.includes('--require-provisioned');
  const issues = validatePreviewEnvironment({
    environment: readJson(ENVIRONMENT_PATH),
    env,
    requireProvisioned,
    workflow: readFileSync(WORKFLOW_PATH, 'utf8'),
    wrangler: readWrangler(),
  });

  if (issues.length > 0) {
    console.error('[check:preview:environment] 配置校验失败：');
    for (const issue of issues) console.error(`- ${issue}`);
    return 1;
  }

  const status = readJson(ENVIRONMENT_PATH).status;
  if (!requireProvisioned && status === 'not-provisioned') {
    console.log('[check:preview:environment] DEFERRED：preview 资源尚未纳管，保持 fail-closed。');
  } else {
    console.log('[check:preview:environment] 通过：preview 资源与部署输入满足门禁。');
  }
  return 0;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
