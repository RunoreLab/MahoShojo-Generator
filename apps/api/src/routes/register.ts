import type { Hono } from 'hono';
import { routeDefinitions } from '#/generated/routes';
import type { HonoAppVariables } from '#/middleware/request-metadata';
import { dispatchRoute } from '#/routes/dispatcher';

export const registerRoutes = (app: Hono<{ Variables: HonoAppVariables }>): void => {
  for (const definition of routeDefinitions) {
    app.all(definition.pattern, (context) => dispatchRoute(context, definition));
  }
};
