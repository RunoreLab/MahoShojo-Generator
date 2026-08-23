import type { Hono } from 'hono';
import { routeDefinitions } from '@/server/generated/routes';
import { dispatchRoute } from '@/server/routes/dispatcher';
import type { HonoAppVariables } from '@/server/middleware/request-metadata';

export const registerRoutes = (app: Hono<{ Variables: HonoAppVariables }>): void => {
  for (const definition of routeDefinitions) {
    app.all(definition.pattern, (context) => dispatchRoute(context, definition));
  }
};
