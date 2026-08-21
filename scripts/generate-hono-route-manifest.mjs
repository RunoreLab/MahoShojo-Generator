import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const apiRoot = path.join(projectRoot, 'app', 'api');
const outputFile = path.join(projectRoot, 'server', 'generated', 'legacy-routes.ts');
const allowlistFile = path.join(projectRoot, 'config', 'hono-api-routes.json');

const readRouteAllowlist = async () => {
  const payload = JSON.parse(await readFile(allowlistFile, 'utf8'));
  const routeIds = payload?.routeIds;
  if (!Array.isArray(routeIds) || routeIds.length === 0) {
    throw new Error('config/hono-api-routes.json 必须提供非空 routeIds 数组');
  }
  if (routeIds.some((routeId) => typeof routeId !== 'string' || !routeId.trim())) {
    throw new Error('Hono routeIds 只能包含非空字符串');
  }

  const normalizedRouteIds = routeIds.map((routeId) => routeId.trim());
  if (new Set(normalizedRouteIds).size !== normalizedRouteIds.length) {
    throw new Error('Hono routeIds 不得重复');
  }
  return normalizedRouteIds;
};

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(absolutePath));
      continue;
    }
    if (entry.isFile() && entry.name === 'route.ts') files.push(absolutePath);
  }

  return files;
};

const toHonoSegment = (segment) => {
  const catchAll = segment.match(/^\[\.\.\.([^\]]+)\]$/);
  if (catchAll) return '*';

  const optionalCatchAll = segment.match(/^\[\[\.\.\.([^\]]+)\]\]$/);
  if (optionalCatchAll) return '*';

  const dynamic = segment.match(/^\[([^\]]+)\]$/);
  if (dynamic) return `:${dynamic[1]}`;
  return segment;
};

const routeRank = (routePath) => {
  const segments = routePath.split('/').filter(Boolean);
  const wildcardCount = segments.filter((segment) => segment === '*').length;
  const dynamicCount = segments.filter((segment) => segment.startsWith(':')).length;
  const staticCount = segments.length - wildcardCount - dynamicCount;
  return staticCount * 10_000 + segments.length * 100 - dynamicCount * 10 - wildcardCount * 1_000;
};

const allowedRouteIds = await readRouteAllowlist();
const allowedRouteIdSet = new Set(allowedRouteIds);
const routeFiles = await walk(apiRoot);
const discoveredDefinitions = routeFiles
  .map((absolutePath) => {
    const relativeToApi = path.relative(apiRoot, absolutePath).replaceAll(path.sep, '/');
    const routeId = relativeToApi.replace(/\/route\.ts$/, '');
    const segments = routeId.split('/').map(toHonoSegment);
    const routePath = `/api/${segments.join('/')}`;
    const importPath = `../../app/api/${relativeToApi.replace(/\.ts$/, '')}`;
    return { importPath, routeId, routePath };
  });

const discoveredRouteIdSet = new Set(discoveredDefinitions.map((definition) => definition.routeId));
const missingRouteIds = allowedRouteIds.filter((routeId) => !discoveredRouteIdSet.has(routeId));
if (missingRouteIds.length > 0) {
  throw new Error(`Hono 路由白名单包含不存在的 routeId：${missingRouteIds.join(', ')}`);
}

const definitions = discoveredDefinitions
  .filter((definition) => allowedRouteIdSet.has(definition.routeId))
  .sort((left, right) => routeRank(right.routePath) - routeRank(left.routePath)
    || left.routePath.localeCompare(right.routePath));

const lines = [
  '// 此文件由 scripts/generate-hono-route-manifest.mjs 自动生成，请勿手工编辑。',
  "import type { LegacyRouteDefinition, LegacyRouteModule } from '@/server/legacy/types';",
  '',
  'export const legacyRouteDefinitions: LegacyRouteDefinition[] = [',
];

for (const definition of definitions) {
  lines.push('  {');
  lines.push(`    id: ${JSON.stringify(definition.routeId)},`);
  lines.push(`    pattern: ${JSON.stringify(definition.routePath)},`);
  lines.push(`    load: () => import(${JSON.stringify(definition.importPath)}) as unknown as Promise<LegacyRouteModule>,`);
  lines.push('  },');
}

lines.push('];', '');

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8');
console.log(`[hono-routes] generated ${definitions.length} allowlisted routes -> ${path.relative(projectRoot, outputFile)}`);
