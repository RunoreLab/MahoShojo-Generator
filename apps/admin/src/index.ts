import { createAdminApp, setAdminSecurityHeaders } from './app';
import { loadAdminConfiguration } from './configuration';
import {
  createAccessJwtVerifier,
  type AccessJwtVerifierOptions,
  type AccessVerifier,
} from './security/access';

type AdminWorkerDependencies = {
  createAccessVerifier?: (options: AccessJwtVerifierOptions) => AccessVerifier;
};

const configurationErrorResponse = (): Response => {
  const response = Response.json(
    { error: 'ADMIN_CONFIGURATION_INVALID' },
    { status: 503 },
  );
  setAdminSecurityHeaders(response.headers);
  return response;
};

export const createAdminWorker = ({
  createAccessVerifier = createAccessJwtVerifier,
}: AdminWorkerDependencies = {}) => {
  // Cache only bounded, validated deployment configurations—not request state.
  // This keeps jose's RemoteJWKSet key/cooldown cache alive even if the runtime
  // supplies a fresh bindings wrapper for each request.
  const applicationsByConfiguration = new Map<string, ReturnType<typeof createAdminApp>>();

  return {
    async fetch(request: Request, env: CloudflareBindings): Promise<Response> {
      try {
        const configuration = loadAdminConfiguration(env);
        const configurationKey = JSON.stringify([
          configuration.accessIssuer,
          configuration.accessAudience,
          configuration.accessJwksUrl,
          env.ADMIN_PRINCIPALS_JSON?.trim(),
        ]);
        let app = applicationsByConfiguration.get(configurationKey);
        if (!app) {
          const accessVerifier = createAccessVerifier({
            issuer: configuration.accessIssuer,
            audience: configuration.accessAudience,
            jwksUrl: configuration.accessJwksUrl,
          });
          app = createAdminApp({
            accessVerifier,
            principals: configuration.principals,
          });
          if (applicationsByConfiguration.size >= 4) {
            const oldestKey = applicationsByConfiguration.keys().next().value;
            if (oldestKey !== undefined) applicationsByConfiguration.delete(oldestKey);
          }
          applicationsByConfiguration.set(configurationKey, app);
        }
        return await app.fetch(request, env);
      } catch {
        return configurationErrorResponse();
      }
    },
  };
};

export default createAdminWorker();
