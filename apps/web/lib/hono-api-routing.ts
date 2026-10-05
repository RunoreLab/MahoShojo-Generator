import { honoApiConfig } from '@/config/hono-api';
import honoApiRoutes from '../../../config/hono-api-routes.json';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const honoRouteIds = honoApiRoutes.sharedRouteIds;
const honoRouteMethods = honoApiRoutes.methods as Record<string, readonly string[]>;

const honoRoutePatterns = honoRouteIds.map((routeId) => {
  const pattern = routeId
    .split('/')
    .map((segment) => (/^\[[^\]]+\]$/.test(segment) ? '[^/]+' : escapeRegExp(segment)))
    .join('/');
  return {
    route: `/api/${routeId}`,
    methods: Object.freeze((honoRouteMethods[routeId] ?? []).map((method) => method.toUpperCase())),
    pattern: new RegExp(`^/api/${pattern}/?$`),
  };
});

export type HonoApiRouteDefinition = Readonly<{
  route: string;
  methods: readonly string[];
}>;

const findHonoApiRoute = (input: string) => {
  if (!input.startsWith('/api/')) return null;
  const pathname = input.split(/[?#]/, 1)[0] ?? input;
  return honoRoutePatterns.find(({ pattern }) => pattern.test(pathname)) ?? null;
};

export const lookupHonoApiRoute = (
  input: string,
  method?: string,
): HonoApiRouteDefinition | null => {
  const route = findHonoApiRoute(input);
  if (!route) return null;
  if (method === undefined) {
    return Object.freeze({ route: route.route, methods: route.methods });
  }
  const normalizedMethod = method.trim().toUpperCase();
  return route.methods.includes(normalizedMethod)
    ? Object.freeze({ route: route.route, methods: route.methods })
    : null;
};

export const isHonoApiEnabled = (): boolean => honoApiConfig.enabled;

export const isHonoApiPath = (input: string): boolean => {
  return findHonoApiRoute(input) !== null;
};

export const resolveGenerationApiUrl = (input: string): string => {
  if (!isHonoApiEnabled() || !isHonoApiPath(input)) return input;
  return `${honoApiConfig.origin.replace(/\/+$/, '')}${input}`;
};
