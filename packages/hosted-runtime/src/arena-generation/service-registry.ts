import type {
  ArenaGenerationRequestRouteParams,
  ArenaGenerationRouteParams,
  ArenaGenerationService,
} from '@mahoshojo/hosted-api/arena-generation/service';

let configuredService: ArenaGenerationService | null = null;
let expectedUserIdAssertionInstalled = false;

/** Only the Hono production composition supplies this assertion capability. */
export const isArenaHostedIdentityAssertionInstalled = (): boolean =>
  configuredService !== null && expectedUserIdAssertionInstalled;

export const configureArenaGenerationService = (
  service: ArenaGenerationService | null,
  options: Readonly<{ expectedUserIdAssertionInstalled?: boolean }> = {},
): void => {
  configuredService = service;
  expectedUserIdAssertionInstalled = service !== null && options.expectedUserIdAssertionInstalled === true;
};

const unavailable = (): Response => new Response(JSON.stringify({
  code: 'ARENA_GENERATION_SERVICE_UNAVAILABLE',
  error: 'Arena generation service unavailable',
}), {
  status: 503,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  },
});

export const registeredArenaGenerationService: ArenaGenerationService = Object.freeze({
  createSubscription: (request: Request) => (
    configuredService?.createSubscription(request) ?? Promise.resolve(unavailable())
  ),
  create: (request: Request) => (
    configuredService?.create(request) ?? Promise.resolve(unavailable())
  ),
  cancelRequest: (request: Request) => (
    configuredService?.cancelRequest(request) ?? Promise.resolve(unavailable())
  ),
  lookup: (request: Request, params: ArenaGenerationRequestRouteParams) => (
    configuredService?.lookup(request, params) ?? Promise.resolve(unavailable())
  ),
  resume: (request: Request, params: ArenaGenerationRouteParams) => (
    configuredService?.resume(request, params) ?? Promise.resolve(unavailable())
  ),
  status: (request: Request, params: ArenaGenerationRouteParams) => (
    configuredService?.status(request, params) ?? Promise.resolve(unavailable())
  ),
  cancel: (request: Request, params: ArenaGenerationRouteParams) => (
    configuredService?.cancel(request, params) ?? Promise.resolve(unavailable())
  ),
});
