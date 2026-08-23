import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const readRouteAllowlist = async (allowlistFile) => {
  const payload = JSON.parse(await readFile(allowlistFile, 'utf8'));
  const exitedRouteIds = payload?.exitedRouteIds;
  const legacyRouteIds = payload?.legacyRouteIds;
  const sharedRouteIds = payload?.sharedRouteIds;
  if (
    !Array.isArray(exitedRouteIds)
    || !Array.isArray(legacyRouteIds)
    || !Array.isArray(sharedRouteIds)
  ) {
    throw new Error(
      'config/hono-api-routes.json 必须提供 exitedRouteIds、legacyRouteIds 与 sharedRouteIds 数组',
    );
  }
  if (legacyRouteIds.length > 0) {
    throw new Error('Phase 2.5B 结构退出后 legacyRouteIds 必须为空');
  }
  if (sharedRouteIds.length === 0) {
    throw new Error('Hono 路由白名单不得为空');
  }
  const inventoryRouteIds = [...sharedRouteIds, ...exitedRouteIds];
  if (inventoryRouteIds.some((routeId) => typeof routeId !== 'string' || !routeId.trim())) {
    throw new Error('Hono routeIds 只能包含非空字符串');
  }

  const normalizedInventoryRouteIds = inventoryRouteIds.map((routeId) => routeId.trim());
  if (new Set(normalizedInventoryRouteIds).size !== normalizedInventoryRouteIds.length) {
    throw new Error('exitedRouteIds 与 sharedRouteIds 不得重复或重叠');
  }
  return {
    inventoryRouteIds: normalizedInventoryRouteIds,
    sharedRouteIds: sharedRouteIds.map((routeId) => routeId.trim()),
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

export const generateHonoRouteManifest = async (
  projectRoot = process.cwd(),
  { log = console.log } = {},
) => {
  const apiRoot = path.join(projectRoot, 'app', 'api');
  const sharedAdapterRoot = path.join(projectRoot, 'server', 'adapters');
  const outputFile = path.join(projectRoot, 'server', 'generated', 'routes.ts');
  const allowlistFile = path.join(projectRoot, 'config', 'hono-api-routes.json');

  const { inventoryRouteIds, sharedRouteIds } = await readRouteAllowlist(allowlistFile);
  const sharedRouteIdSet = new Set(sharedRouteIds);
  const routeFiles = await walk(apiRoot);
  const discoveredDefinitions = routeFiles.map((absolutePath) => {
    const relativeToApi = path.relative(apiRoot, absolutePath).replaceAll(path.sep, '/');
    const routeId = relativeToApi.replace(/\/route\.ts$/, '');
    const segments = routeId.split('/').map(toHonoSegment);
    const routePath = `/api/${segments.join('/')}`;
    return { routeId, routePath };
  });

  const discoveredRouteIdSet = new Set(discoveredDefinitions.map((definition) => definition.routeId));
  const missingRouteIds = inventoryRouteIds.filter((routeId) => !discoveredRouteIdSet.has(routeId));
  if (missingRouteIds.length > 0) {
    throw new Error(`Hono capability inventory 包含不存在的 routeId：${missingRouteIds.join(', ')}`);
  }

  const definitions = discoveredDefinitions
    .filter((definition) => sharedRouteIdSet.has(definition.routeId))
    .map((definition) => ({
      ...definition,
      adapter: 'shared-service',
      importPath: `../adapters/${definition.routeId}`,
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
  log(
    `[hono-routes] generated ${definitions.length} allowlisted routes `
    + `(${sharedRouteIdSet.size} shared, 0 legacy) -> ${path.relative(projectRoot, outputFile)}`,
  );
};

const executedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (executedFile && import.meta.url === pathToFileURL(executedFile).href) {
  await generateHonoRouteManifest();
}
