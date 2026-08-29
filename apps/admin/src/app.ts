import { Hono } from 'hono';

import type { AccessIdentity, AccessVerifier } from './security/access';
import {
  authorizeIdentity,
  createRoutePolicyRegistry,
  type AdminPrincipal,
  type PrincipalDirectory,
} from './security/authorization';
import { AdminSecurityError } from './security/errors';
import { assertMutationRequestSafety } from './security/request-safety';

type AdminVariables = {
  accessIdentity: AccessIdentity;
  principal: AdminPrincipal;
};

type AdminAppDependencies = {
  accessVerifier: AccessVerifier;
  principals: PrincipalDirectory;
};

const ROUTE_POLICIES = createRoutePolicyRegistry([
  {
    method: 'GET',
    path: '/',
    capability: 'admin.shell.read',
    requestKind: 'read',
    action: 'admin.shell.read',
    audit: {
      required: false,
      reasonRequired: false,
      expectedVersionRequired: false,
      idempotencyKeyRequired: false,
    },
  },
  {
    method: 'GET',
    path: '/api/admin/session',
    capability: 'admin.shell.read',
    requestKind: 'read',
    action: 'admin.session.read',
    audit: {
      required: false,
      reasonRequired: false,
      expectedVersionRequired: false,
      idempotencyKeyRequired: false,
    },
  },
]);

const SHELL_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MahoShojo Admin</title>
</head>
<body>
  <main>
    <h1>Admin 安全基座</h1>
    <p>G3-P0 只建立独立边界与安全原语；业务管理能力尚未启用。</p>
  </main>
</body>
</html>`;

export const setAdminSecurityHeaders = (headers: Headers): void => {
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Security-Policy', "default-src 'none'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; style-src 'self'");
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
};

export const createAdminApp = ({ accessVerifier, principals }: AdminAppDependencies) => {
  const app = new Hono<{ Variables: AdminVariables }>();

  app.use('*', async (context, next) => {
    await next();
    setAdminSecurityHeaders(context.res.headers);
  });

  app.get('/health/live', (context) => context.json({ status: 'ok', scope: 'g3-p0-prework' }));

  app.use('*', async (context, next) => {
    const assertion = context.req.header('Cf-Access-Jwt-Assertion');
    if (!assertion) return context.json({ error: 'ADMIN_UNAUTHORIZED' }, 401);

    try {
      const accessIdentity = await accessVerifier.verify(assertion);
      const policy = ROUTE_POLICIES.requirePolicy(context.req.method, context.req.path);
      if (policy.requestKind === 'mutation') assertMutationRequestSafety(context.req.raw);
      const principal = authorizeIdentity(accessIdentity, principals, policy.capability);
      context.set('accessIdentity', accessIdentity);
      context.set('principal', principal);
      await next();
    } catch (error) {
      if (error instanceof AdminSecurityError) {
        const status = error.code.startsWith('ACCESS_') ? 401 : 403;
        return context.json({ error: status === 401 ? 'ADMIN_UNAUTHORIZED' : 'ADMIN_FORBIDDEN' }, status);
      }
      return context.json({ error: 'ADMIN_INTERNAL_ERROR' }, 500);
    }
  });

  app.get('/', (context) => context.html(SHELL_HTML));
  app.get('/api/admin/session', (context) => {
    const principal = context.get('principal');
    return context.json({
      principalId: principal.id,
      principalKind: principal.externalIdentity.kind,
      capabilities: principal.capabilities,
    });
  });

  app.notFound((context) => context.json({ error: 'ADMIN_FORBIDDEN' }, 403));
  app.onError((_error, context) => context.json({ error: 'ADMIN_INTERNAL_ERROR' }, 500));

  return app;
};
