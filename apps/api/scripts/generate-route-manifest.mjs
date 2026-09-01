import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultAppRoot = path.resolve(scriptDirectory, '..');

const normalizeRouteIds = (routeIds, fieldName) => routeIds.map((routeId) => {
  if (typeof routeId !== 'string' || !routeId.trim()) {
    throw new Error(`${fieldName} 只能包含非空字符串`);
  }
  const normalized = routeId.trim();
  const segments = normalized.split('/');
  if (
    normalized.startsWith('/')
    || normalized.includes('\\')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`${fieldName} 包含非法 routeId：${normalized}`);
  }
  return normalized;
});

const readRouteInventory = async (inventoryFile) => {
  const payload = JSON.parse(await readFile(inventoryFile, 'utf8'));
  const exitedRouteIds = payload?.exitedRouteIds;
  const legacyRouteIds = payload?.legacyRouteIds;
  const sharedRouteIds = payload?.sharedRouteIds;
  const methods = payload?.methods;
  if (
    !Array.isArray(exitedRouteIds)
    || !Array.isArray(legacyRouteIds)
    || !Array.isArray(sharedRouteIds)
  ) {
    throw new Error(
      'config/hono-api-routes.json 必须提供 exitedRouteIds、legacyRouteIds 与 sharedRouteIds 数组',
    );
  }
  if (
    typeof methods !== 'object'
    || methods === null
    || Array.isArray(methods)
  ) {
    throw new Error('config/hono-api-routes.json 必须提供 methods 对象');
  }
  if (legacyRouteIds.length > 0) {
    throw new Error('Phase 2.5B 结构退出后 legacyRouteIds 必须为空');
  }
  if (sharedRouteIds.length === 0) {
    throw new Error('Hono 路由白名单不得为空');
  }

  const normalizedExitedRouteIds = normalizeRouteIds(exitedRouteIds, 'exitedRouteIds');
  const normalizedSharedRouteIds = normalizeRouteIds(sharedRouteIds, 'sharedRouteIds');
  const inventoryRouteIds = [...normalizedSharedRouteIds, ...normalizedExitedRouteIds];
  if (new Set(inventoryRouteIds).size !== inventoryRouteIds.length) {
    throw new Error('exitedRouteIds 与 sharedRouteIds 不得重复或重叠');
  }
  const normalizedMethods = new Map();
  for (const routeId of normalizedSharedRouteIds) {
    const routeMethods = methods[routeId];
    if (!Array.isArray(routeMethods) || routeMethods.length === 0) {
      throw new Error(`共享 Hono route 缺少 methods：${routeId}`);
    }
    const normalizedRouteMethods = routeMethods.map((method) => {
      if (typeof method !== 'string' || !/^[A-Z]+$/u.test(method)) {
        throw new Error(`共享 Hono route methods 非法：${routeId}`);
      }
      return method;
    });
    if (new Set(normalizedRouteMethods).size !== normalizedRouteMethods.length) {
      throw new Error(`共享 Hono route methods 重复：${routeId}`);
    }
    normalizedMethods.set(routeId, normalizedRouteMethods);
  }
  for (const routeId of Object.keys(methods)) {
    if (!normalizedMethods.has(routeId)) {
      throw new Error(`methods 包含非 shared route：${routeId}`);
    }
  }
  return { routeIds: normalizedSharedRouteIds, methods: normalizedMethods };
};

const toHonoSegment = (segment) => {
  if (/^\[\[\.\.\.[^\]]+\]\]$/u.test(segment)) return '*';
  if (/^\[\.\.\.[^\]]+\]$/u.test(segment)) return '*';
  const dynamic = segment.match(/^\[([^\]]+)\]$/u);
  return dynamic ? `:${dynamic[1]}` : segment;
};

const toRoutePath = (routeId) => `/api/${routeId.split('/').map(toHonoSegment).join('/')}`;

const routeRank = (routePath) => {
  const segments = routePath.split('/').filter(Boolean);
  const wildcardCount = segments.filter((segment) => segment === '*').length;
  const dynamicCount = segments.filter((segment) => segment.startsWith(':')).length;
  const staticCount = segments.length - wildcardCount - dynamicCount;
  return staticCount * 10_000 + segments.length * 100 - dynamicCount * 10 - wildcardCount * 1_000;
};

export const generateHonoRouteManifest = async (
  appRoot = defaultAppRoot,
  {
    inventoryFile = path.resolve(appRoot, '..', '..', 'config', 'hono-api-routes.json'),
    log = console.log,
  } = {},
) => {
  const adapterRoot = path.join(appRoot, 'src', 'adapters');
  const outputFile = path.join(appRoot, 'src', 'generated', 'routes.ts');
  const inventory = await readRouteInventory(inventoryFile);
  const sharedRouteIds = inventory.routeIds;

  for (const routeId of sharedRouteIds) {
    const adapterPath = path.join(adapterRoot, `${routeId}.ts`);
    try {
      await access(adapterPath);
    } catch {
      throw new Error(`共享 Hono route adapter 不存在：${path.relative(appRoot, adapterPath)}`);
    }
  }

  const definitions = sharedRouteIds
    .map((routeId) => ({
      routeId,
      routePath: toRoutePath(routeId),
      importPath: `../adapters/${routeId}`,
      methods: inventory.methods.get(routeId),
    }))
    .sort((left, right) => routeRank(right.routePath) - routeRank(left.routePath)
      || left.routePath.localeCompare(right.routePath));

  const lines = [
    '// 此文件由 apps/api/scripts/generate-route-manifest.mjs 自动生成，请勿手工编辑。',
    "import type { RouteDefinition, RouteModule } from '#/routes/types';",
    '',
    'export const routeDefinitions: RouteDefinition[] = [',
  ];

  for (const definition of definitions) {
    lines.push('  {');
    lines.push(`    id: ${JSON.stringify(definition.routeId)},`);
    lines.push(`    pattern: ${JSON.stringify(definition.routePath)},`);
    lines.push('    adapter: "shared-service",');
    lines.push(`    methods: ${JSON.stringify(definition.methods)},`);
    lines.push(`    load: () => import(${JSON.stringify(definition.importPath)}) as unknown as Promise<RouteModule>,`);
    lines.push('  },');
  }

  lines.push('];', '');

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8');
  log(
    `[hono-routes] generated ${definitions.length} shared routes -> ${path.relative(appRoot, outputFile)}`,
  );
};

const executedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (executedFile && import.meta.url === pathToFileURL(executedFile).href) {
  await generateHonoRouteManifest();
}
