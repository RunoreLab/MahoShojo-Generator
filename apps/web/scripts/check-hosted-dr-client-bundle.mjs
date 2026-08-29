import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const manifest = JSON.parse(readFileSync(
  path.join(repositoryRoot, 'config/hosted-dr-capabilities.json'),
  'utf8',
));

const argumentValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} 缺少路径参数`);
  return path.isAbsolute(value)
    ? value
    : path.resolve(process.cwd(), value);
};

const staticRoot = argumentValue('--dir', path.join(process.cwd(), '.next/static'));
if (!existsSync(staticRoot) || !statSync(staticRoot).isDirectory()) {
  throw new Error(`Hosted DR client bundle 目录不存在: ${staticRoot}`);
}

const listJavaScript = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScript(target);
    return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
  });

const controlPlane = manifest.controlPlane;
const routingTokens = [
  controlPlane.primaryOrigin,
  controlPlane.drOrigin,
  controlPlane.primaryProbePath,
  controlPlane.drProbePath,
];
const secretNames = [...new Set(manifest.capabilities.flatMap((capability) => (
  capability.requiredSecrets.map(({ name }) => name)
)))].sort();
const bindingNames = [...new Set(manifest.capabilities.flatMap((capability) => (
  capability.requiredBindings
)))].sort();
const failures = [];
const routingSources = [];

const originPattern = /https?:\/\/(?:\[[^\]]+\]|[^/\s"'`;,)}]+)/gu;
const scanInternalOrigins = (relativePath, source) => {
  for (const match of source.matchAll(originPattern)) {
    const origin = match[0];
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      failures.push(`${relativePath}: client bundle 包含非法 origin ${origin}`);
      continue;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      isIP(hostname) !== 0
      || !hostname.includes('.')
      || hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || hostname.endsWith('.internal')
    ) {
      failures.push(`${relativePath}: client bundle 包含 internal endpoint ${origin}`);
    }
  }
};

for (const filePath of listJavaScript(staticRoot)) {
  const source = readFileSync(filePath, 'utf8');
  const relativePath = path.relative(staticRoot, filePath);
  for (const secretName of secretNames) {
    if (source.includes(secretName)) {
      failures.push(`${relativePath}: client bundle 包含 secret ${secretName}`);
    }
  }
  scanInternalOrigins(relativePath, source);
  if (routingTokens.every((token) => source.includes(token))) {
    routingSources.push({ relativePath, source });
  }
}

if (routingSources.length === 0) {
  failures.push('client bundle 缺少完整 Hosted DR routing projection');
}

for (const { relativePath, source } of routingSources) {
  for (const bindingName of bindingNames) {
    const bindingIdentifier = new RegExp(
      `(^|[^A-Za-z0-9_$])${bindingName}([^A-Za-z0-9_$]|$)`,
      'u',
    );
    if (bindingIdentifier.test(source)) {
      failures.push(`${relativePath}: Hosted routing chunk 包含 binding ${bindingName}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Hosted DR client bundle safety failed:\n- ${failures.join('\n- ')}`);
}

console.log(
  `Hosted DR client bundle safety OK: ${routingSources.length} routing chunk(s), `
  + `${secretNames.length} secret and ${bindingNames.length} binding name(s) absent.`,
);
