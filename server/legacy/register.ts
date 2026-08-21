import type { Hono } from 'hono';
import { legacyRouteDefinitions } from '@/server/generated/legacy-routes';
import { dispatchLegacyRoute } from '@/server/legacy/dispatcher';
import type { HonoAppVariables } from '@/server/middleware/request-metadata';

export const registerLegacyRoutes = (app: Hono<{ Variables: HonoAppVariables }>): void => {
  for (const definition of legacyRouteDefinitions) {
    app.all(definition.pattern, (context) => dispatchLegacyRoute(context, definition));
  }
};
