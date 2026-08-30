import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const arguments_ = process.argv.slice(2);
const readArgument = (name, fallback) => {
  const index = arguments_.indexOf(name);
  if (index < 0) return fallback;
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少值`);
  return value;
};
const write = arguments_.includes('--write');
const valueArguments = new Set(['--manifest', '--output']);
for (let index = 0; index < arguments_.length; index += 1) {
  const name = arguments_[index];
  if (name === '--write') continue;
  if (!valueArguments.has(name) || index + 1 >= arguments_.length) {
    throw new Error(`未知或不完整参数：${name ?? ''}`);
  }
  index += 1;
}

const manifestPath = path.resolve(repositoryRoot, readArgument(
  '--manifest',
  'config/arena-room-origins.json',
));
const outputPath = path.resolve(repositoryRoot, readArgument(
  '--output',
  'apps/web/config/arena-room-origins.generated.ts',
));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const isCanonicalHttpsOrigin = (value) => {
  if (typeof value !== 'string' || value === '*' || value.includes('*')) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash
      && url.origin === value;
  } catch {
    return false;
  }
};
const expectedTopKeys = ['authority', 'cloudflareDr', 'schemaVersion', 'targets'];
const exactKeys = (value, expected) => value
  && typeof value === 'object'
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const failures = [];
if (!exactKeys(manifest, expectedTopKeys)) failures.push('顶层字段必须精确一致');
if (manifest.schemaVersion !== 1) failures.push('schemaVersion 必须为 1');
if (manifest.authority !== 'hono-redis-single-writer') {
  failures.push('Room authority 必须保持 Hono/Redis single writer');
}
if (manifest.cloudflareDr !== 'excluded') failures.push('Room v1 必须明确排除 Cloudflare DR');
if (!exactKeys(manifest.targets, ['preview', 'production'])) {
  failures.push('targets 必须精确声明 production/preview');
}
for (const target of ['production', 'preview']) {
  const candidate = manifest.targets?.[target];
  if (!exactKeys(candidate, ['allowedWebOrigins', 'logicalOrigin', 'provisioning'])) {
    failures.push(`${target} target 字段非法`);
    continue;
  }
  if (!isCanonicalHttpsOrigin(candidate.logicalOrigin)) {
    failures.push(`${target} logicalOrigin 必须为 canonical HTTPS origin`);
  }
  if (!['not-provisioned', 'provisioned'].includes(candidate.provisioning)) {
    failures.push(`${target} provisioning 非法`);
  }
  if (!Array.isArray(candidate.allowedWebOrigins)
    || candidate.allowedWebOrigins.length === 0
    || new Set(candidate.allowedWebOrigins).size !== candidate.allowedWebOrigins.length
    || candidate.allowedWebOrigins.some((origin) => !isCanonicalHttpsOrigin(origin))) {
    failures.push(`${target} allowedWebOrigins 必须是非空、唯一的 canonical HTTPS origins`);
  }
}
if (manifest.targets?.production?.provisioning !== 'not-provisioned') {
  failures.push('production Room origin 未实际配置前必须保持 not-provisioned');
}
if (manifest.targets?.preview?.provisioning !== 'provisioned') {
  failures.push('preview Room origin 已完成 DNS/TLS/Caddy 后必须记为 provisioned');
}
if (failures.length > 0) {
  for (const failure of failures) console.error(`[arena-room-origins] ${failure}`);
  process.exit(1);
}

const clientTargets = Object.fromEntries(
  ['production', 'preview'].map((target) => [target, {
    logicalOrigin: manifest.targets[target].logicalOrigin,
    provisioning: manifest.targets[target].provisioning,
  }]),
);
const rendered = [
  '// 此文件由 config/arena-room-origins.json 生成，请勿手工编辑。',
  `export const arenaRoomClientTargets = ${JSON.stringify(clientTargets, null, 2)} as const;`,
  '',
].join('\n');

if (write) {
  await writeFile(outputPath, rendered, 'utf8');
  console.log('Arena Room client-safe origins generated.');
} else {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== rendered) {
    console.error('Arena Room client origin 投影 drift；运行 pnpm generate:arena-room-client');
    process.exit(1);
  }
  console.log('Arena Room origin contract OK: preview provisioned, production fail closed.');
}
