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

const absoluteUrlStartPattern = /https?:\/\//giu;
const absoluteUrlCandidatePattern = /^https?:\/\/(?:\[[^\]\s"'`\\]+\](?::\d+)?|[^/?#\s"'`\\;,)}]+)(?:\/[^\s"'`\\]*|[?#][^\s"'`\\]*)?/iu;
const protocolRelativeUrlLiteralPattern = /(["'`])(\/\/[^\s"'`\\]+)\1/gu;
const dynamicIpv6UrlCandidatePattern = /^(?:https?:)?\/\/\[\$\{[A-Za-z_$][A-Za-z0-9_.$]*\}\]$/iu;
const protocolRelativeBase = 'https://bundle.invalid';
const frameworkUrlFixtures = new Map([
  ['chunks/main-', new Set(['http://n', 'http://f'])],
  ['chunks/polyfills-', new Set([
    'https://a',
    'https://a/c%20d?a=1&c=3',
    'https://a@b',
    'https://тест',
    'https://a#б',
    'https://x',
  ])],
]);
const publicUrlMetadataRules = [
  {
    hostname: 'api.kourichat.com',
    pathname: '/register',
    queryKeys: ['aff'],
    hash: '',
  },
  {
    hostname: 'chatboxai.app',
    pathname: '/zh/',
    queryKeys: [],
    hash: '#pricing',
  },
  {
    hostname: '88996.cloud',
    pathname: '/register',
    queryKeys: ['aff'],
    hash: '',
  },
  {
    hostname: 'nova.cervus.top',
    pathname: '/register',
    queryKeys: ['aff'],
    hash: '',
  },
  {
    hostname: 'qm.qq.com',
    pathname: '/cgi-bin/qm/qr',
    queryKeys: ['authKey', 'jump_from', 'k'],
    hash: '',
  },
  {
    hostname: 'qun.qq.com',
    pathname: '/universal-share/share',
    queryKeys: ['ac', 'authKey', 'busi_data', 'data', 'svctype', 'tempid'],
    hash: '',
  },
  {
    hostname: 'www.googletagmanager.com',
    pathname: '/gtag/js',
    queryKeys: ['id'],
    hash: '',
  },
  {
    hostname: 'nextjs.org',
    pathname: '/docs/app/api-reference/functions/use-search-params',
    queryKeys: [],
    hash: '#updating-searchparams',
  },
];
const isAllowedSyntheticUrl = (relativePath, source, candidate, matchIndex) => {
  for (const [prefix, candidates] of frameworkUrlFixtures) {
    if (relativePath.startsWith(prefix) && candidates.has(candidate)) return true;
  }
  if (candidate !== 'http://localhost/') return false;
  const prefix = source.slice(Math.max(0, matchIndex - 64), matchIndex);
  return prefix.endsWith('location&&location.href?location.href:"')
    || prefix.endsWith('location?.href??"');
};
const isAllowedPublicUrlMetadata = (candidate, parsed) => {
  if (!candidate.toLowerCase().startsWith('https://')) return false;
  if (parsed.username || parsed.password) return false;
  const queryKeys = [...parsed.searchParams.keys()].sort();
  return publicUrlMetadataRules.some((rule) => (
    parsed.hostname === rule.hostname
    && parsed.pathname === rule.pathname
    && parsed.hash === rule.hash
    && queryKeys.length === rule.queryKeys.length
    && queryKeys.every((key, index) => key === rule.queryKeys[index])
  ));
};

const listStaticUrlCandidates = function* (source) {
  for (const match of source.matchAll(absoluteUrlStartPattern)) {
    const matchIndex = match.index ?? 0;
    const candidate = source.slice(matchIndex).match(absoluteUrlCandidatePattern)?.[0];
    if (candidate) yield { candidate, matchIndex };
  }
  for (const match of source.matchAll(protocolRelativeUrlLiteralPattern)) {
    const candidate = match[2];
    if (!candidate) continue;
    yield {
      candidate,
      matchIndex: (match.index ?? 0) + 1,
    };
  }
};

const scanStaticUrls = (relativePath, source) => {
  for (const { candidate, matchIndex } of listStaticUrlCandidates(source)) {
    if (dynamicIpv6UrlCandidatePattern.test(candidate)) continue;
    let parsed;
    try {
      parsed = new URL(candidate, protocolRelativeBase);
    } catch {
      failures.push(`${relativePath}: client bundle 包含非法 origin`);
      continue;
    }
    const allowedSyntheticUrl = isAllowedSyntheticUrl(
      relativePath,
      source,
      candidate,
      matchIndex,
    );
    const allowedPublicUrlMetadata = isAllowedPublicUrlMetadata(candidate, parsed);
    if (
      (parsed.username || parsed.password || parsed.search || parsed.hash)
      && !allowedSyntheticUrl
      && !allowedPublicUrlMetadata
    ) {
      failures.push(
        `${relativePath}: client bundle 包含 credential/query/fragment URL`,
      );
      continue;
    }
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/^\[|\]$/gu, '')
      .replace(/\.+$/u, '');
    const isInternal = hostname.length === 0
      || isIP(hostname) !== 0
      || !hostname.includes('.')
      || hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || hostname.endsWith('.internal');
    if (
      isInternal
      && !allowedSyntheticUrl
    ) {
      failures.push(`${relativePath}: client bundle 包含 internal endpoint`);
    }
  }
};

const scanBindings = (relativePath, source) => {
  for (const bindingName of bindingNames) {
    const bindingIdentifier = new RegExp(
      `(^|[^A-Za-z0-9_$])${bindingName}([^A-Za-z0-9_$]|$)`,
      'u',
    );
    if (bindingIdentifier.test(source)) {
      failures.push(`${relativePath}: client bundle 包含 binding ${bindingName}`);
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
  scanStaticUrls(relativePath, source);
  scanBindings(relativePath, source);
  if (routingTokens.every((token) => source.includes(token))) {
    routingSources.push({ relativePath, source });
  }
}

if (routingSources.length === 0) {
  failures.push('client bundle 缺少完整 Hosted DR routing projection');
}

if (failures.length > 0) {
  throw new Error(`Hosted DR client bundle safety failed:\n- ${failures.join('\n- ')}`);
}

console.log(
  `Hosted DR client bundle safety OK: ${routingSources.length} routing chunk(s), `
  + `${secretNames.length} secret and ${bindingNames.length} binding name(s) absent.`,
);
