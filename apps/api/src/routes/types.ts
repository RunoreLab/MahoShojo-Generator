export const HTTP_METHODS = [
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export type RouteContext = {
  params: Promise<Record<string, string>>;
};

export type RouteHandler = (
  request: Request,
  context: RouteContext,
) => Response | Promise<Response>;

export type RouteModule = Partial<Record<HttpMethod, RouteHandler>>;

export type RouteAdapter = 'shared-service';

export type RouteDefinition = {
  id: string;
  pattern: string;
  adapter: RouteAdapter;
  methods: HttpMethod[];
  load: () => Promise<RouteModule>;
};

export type NodeExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void;
};
