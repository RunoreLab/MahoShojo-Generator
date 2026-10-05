import { readFile } from 'node:fs/promises';
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
for (let index = 0; index < arguments_.length; index += 1) {
  const name = arguments_[index];
  if (name !== '--manifest' || index + 1 >= arguments_.length) {
    throw new Error(`未知或不完整参数：${name ?? ''}`);
  }
  index += 1;
}

const manifestPath = path.resolve(repositoryRoot, readArgument(
  '--manifest',
  'config/arena-room-origins.json',
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
const exactKeys = (value, expected) => value
  && typeof value === 'object'
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

const failures = [];
if (!exactKeys(manifest, ['authority', 'cloudflareDr', 'schemaVersion', 'targets'])) {
  failures.push('顶层字段必须精确一致');
}
if (manifest.schemaVersion !== 1) failures.push('schemaVersion 必须为 1');
if (manifest.authority !== 'hono-redis-single-writer') {
  failures.push('Room authority 必须保持 Hono/Redis single writer');
}
if (manifest.cloudflareDr !== 'excluded') {
  failures.push('Room v1 必须明确排除 Cloudflare DR');
}
if (!exactKeys(manifest.targets, ['preview', 'production'])) {
  failures.push('targets 必须精确声明 production/preview');
}
for (const target of ['production', 'preview']) {
  const candidate = manifest.targets?.[target];
  if (!exactKeys(candidate, ['allowedWebOrigins'])) {
    failures.push(`${target} target 只能声明 caller allowedWebOrigins`);
    continue;
  }
  if (!Array.isArray(candidate.allowedWebOrigins)
    || candidate.allowedWebOrigins.length === 0
    || new Set(candidate.allowedWebOrigins).size !== candidate.allowedWebOrigins.length
    || candidate.allowedWebOrigins.some((origin) => !isCanonicalHttpsOrigin(origin))) {
    failures.push(`${target} allowedWebOrigins 必须是非空、唯一的 canonical HTTPS origins`);
  }
}
if (failures.length > 0) {
  for (const failure of failures) console.error(`[arena-room-origin-policy] ${failure}`);
  process.exit(1);
}

console.log('Arena Room origin policy OK: service origin delegated to Hosted Hono ingress.');
