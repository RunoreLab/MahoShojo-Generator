import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const apiRoot = path.join(projectRoot, 'app', 'api');
const sharedAdapterRoot = path.join(projectRoot, 'server', 'adapters');
const outputFile = path.join(projectRoot, 'server', 'generated', 'routes.ts');
const allowlistFile = path.join(projectRoot, 'config', 'hono-api-routes.json');

const readRouteAllowlist = async () => {
  const payload = JSON.parse(await readFile(allowlistFile, 'utf8'));
  const legacyRouteIds = payload?.legacyRouteIds;
  const sharedRouteIds = payload?.sharedRouteIds;
  if (!Array.isArray(legacyRouteIds) || !Array.isArray(sharedRouteIds)) {
    throw new Error('config/hono-api-routes.json 必须提供 legacyRouteIds 与 sharedRouteIds 数组');
  }
  const routeIds = [...legacyRouteIds, ...sharedRouteIds];
  if (routeIds.length === 0) {
    throw new Error('Hono 路由白名单不得为空');
  }
  if (routeIds.some((routeId) => typeof routeId !== 'string' || !routeId.trim())) {
    throw new Error('Hono routeIds 只能包含非空字符串');
  }

  const normalizedRouteIds = routeIds.map((routeId) => routeId.trim());
  if (new Set(normalizedRouteIds).size !== normalizedRouteIds.length) {
    throw new Error('legacyRouteIds 与 sharedRouteIds 不得重复或重叠');
  }
  const normalizedLegacyRouteIds = legacyRouteIds.map((routeId) => routeId.trim());
  return {
    legacyRouteIds: normalizedLegacyRouteIds,
    routeIds: normalizedRouteIds,
    sharedRouteIdSet: new Set(sharedRouteIds.map((routeId) => routeId.trim())),
  };
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

const { legacyRouteIds, routeIds: allowedRouteIds, sharedRouteIdSet } = await readRouteAllowlist();
const allowedRouteIdSet = new Set(allowedRouteIds);
const routeFiles = await walk(apiRoot);
const discoveredDefinitions = routeFiles
  .map((absolutePath) => {
    const relativeToApi = path.relative(apiRoot, absolutePath).replaceAll(path.sep, '/');
    const routeId = relativeToApi.replace(/\/route\.ts$/, '');
    const segments = routeId.split('/').map(toHonoSegment);
    const routePath = `/api/${segments.join('/')}`;
    return { routeId, routePath };
  });

const discoveredRouteIdSet = new Set(discoveredDefinitions.map((definition) => definition.routeId));
const missingRouteIds = allowedRouteIds.filter((routeId) => !discoveredRouteIdSet.has(routeId));
if (missingRouteIds.length > 0) {
  throw new Error(`Hono 路由白名单包含不存在的 routeId：${missingRouteIds.join(', ')}`);
}

const definitions = discoveredDefinitions
  .filter((definition) => allowedRouteIdSet.has(definition.routeId))
  .map((definition) => ({
    ...definition,
    adapter: sharedRouteIdSet.has(definition.routeId) ? 'shared-service' : 'legacy-next',
    importPath: sharedRouteIdSet.has(definition.routeId)
      ? `../adapters/${definition.routeId}`
      : `../../app/api/${definition.routeId}/route`,
  }))
  .sort((left, right) => routeRank(right.routePath) - routeRank(left.routePath)
    || left.routePath.localeCompare(right.routePath));

for (const routeId of sharedRouteIdSet) {
  const adapterPath = path.join(sharedAdapterRoot, `${routeId}.ts`);
  try {
    await access(adapterPath);
  } catch {
    throw new Error(`共享 Hono route adapter 不存在：${path.relative(projectRoot, adapterPath)}`);
  }
}

const lines = [
  '// 此文件由 scripts/generate-hono-route-manifest.mjs 自动生成，请勿手工编辑。',
  "import type { RouteDefinition, RouteModule } from '@/server/routes/types';",
  '',
  'export const routeDefinitions: RouteDefinition[] = [',
];

for (const definition of definitions) {
  lines.push('  {');
  lines.push(`    id: ${JSON.stringify(definition.routeId)},`);
  lines.push(`    pattern: ${JSON.stringify(definition.routePath)},`);
  lines.push(`    adapter: ${JSON.stringify(definition.adapter)},`);
  lines.push(`    load: () => import(${JSON.stringify(definition.importPath)}) as unknown as Promise<RouteModule>,`);
  lines.push('  },');
}

lines.push('];', '');

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8');
console.log(
  `[hono-routes] generated ${definitions.length} allowlisted routes `
  + `(${sharedRouteIdSet.size} shared, ${legacyRouteIds.length} legacy) -> ${path.relative(projectRoot, outputFile)}`,
);
