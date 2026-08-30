import { honoApiConfig } from '@/config/hono-api';
import honoApiRoutes from '../../../config/hono-api-routes.json';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const honoRouteIds = honoApiRoutes.sharedRouteIds;

const honoRoutePatterns = honoRouteIds.map((routeId) => {
  const pattern = routeId
    .split('/')
    .map((segment) => (/^\[[^\]]+\]$/.test(segment) ? '[^/]+' : escapeRegExp(segment)))
    .join('/');
  return new RegExp(`^/api/${pattern}/?$`);
});

export const isHonoApiEnabled = (): boolean => honoApiConfig.enabled;

export const isHonoApiPath = (input: string): boolean => {
  if (!input.startsWith('/api/')) return false;
  const pathname = input.split(/[?#]/, 1)[0];
  return honoRoutePatterns.some((pattern) => pattern.test(pathname));
};

export const resolveGenerationApiUrl = (input: string): string => {
  if (!isHonoApiEnabled() || !isHonoApiPath(input)) return input;
  return `${honoApiConfig.origin.replace(/\/+$/, '')}${input}`;
};
