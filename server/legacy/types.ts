export const LEGACY_HTTP_METHODS = [
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;

export type LegacyHttpMethod = (typeof LEGACY_HTTP_METHODS)[number];

export type LegacyRouteContext = {
  params: Promise<Record<string, string>>;
};

export type LegacyRouteHandler = (
  request: Request,
  context: LegacyRouteContext,
) => Response | Promise<Response>;

export type LegacyRouteModule = Partial<Record<LegacyHttpMethod, LegacyRouteHandler>>;

export type LegacyRouteDefinition = {
  id: string;
  pattern: string;
  load: () => Promise<LegacyRouteModule>;
};

export type NodeExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void;
};
