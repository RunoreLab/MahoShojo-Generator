import { Hono } from 'hono';
import type { AccessIdentity, AccessVerifier } from './security/access';
import { authorizeIdentity, createRoutePolicyRegistry, type AdminPrincipal, type PrincipalDirectory } from './security/authorization';
import { AdminSecurityError } from './security/errors';
import { assertMutationRequestSafety } from './security/request-safety';
import { createAuthnContextSafeRef } from './security/audit';
import { ADMIN_RESOURCES, AdminQuerySchema, READ_CAPABILITIES, AdminHttpError, type AdminAction, type AdminQuery, type AdminReadResponse, type AdminResource } from './business';
type AdminAppDependencies = {
  accessVerifier: AccessVerifier; principals: PrincipalDirectory;
  resolvePrincipal?: (identity: AccessIdentity) => Promise<AdminPrincipal | null>;
  readResource?: (resource: AdminResource, query: AdminQuery) => Promise<AdminReadResponse>;
  assets?: (request: Request) => Promise<Response>;
  actions?: readonly AdminAction[];
  operationStatus?: (principalId: string, key: string) => Promise<unknown>;
  extraReads?: readonly {path:string;capability:string;execute:(request:Request,principalId:string,requestId:string)=>Promise<Response>}[];
};
const readPolicy = (path: string, capability: string) => ({ method: 'GET', path, capability, requestKind: 'read' as const, action: capability,
  audit: { required: false, reasonRequired: false, expectedVersionRequired: false, idempotencyKeyRequired: false } });
const SHELL = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>魔法少女 · 管理工作台</title><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"><h1>Admin 安全基座</h1><p>正在加载管理工作台…</p></div><script type="module" src="/assets/app.js"></script></body></html>';
export const setAdminSecurityHeaders = (headers: Headers): void => {
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; style-src 'self'");
  headers.set('Cross-Origin-Opener-Policy', 'same-origin'); headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  headers.set('Referrer-Policy', 'no-referrer'); headers.set('X-Content-Type-Options', 'nosniff'); headers.set('X-Frame-Options', 'DENY');
};
export const createAdminApp = (dependencies: AdminAppDependencies) => {
  const { accessVerifier, principals, resolvePrincipal, readResource, assets, actions = [] } = dependencies;
  const policies = createRoutePolicyRegistry([
    ...['/', '/api/admin/session', '/api/admin/v1/actions', '/api/admin/v1/operation', '/assets/app.js', '/assets/app.css'].map(path => readPolicy(path, 'admin.shell.read')),
    ...ADMIN_RESOURCES.map(resource => readPolicy('/api/admin/v1/' + resource, READ_CAPABILITIES[resource])),
    ...(dependencies.extraReads??[]).map(route=>readPolicy(route.path,route.capability)),
    ...actions.map(action => ({ method: 'POST', path: '/api/admin/v1/actions/' + action.name, capability: action.capability,
      requestKind: 'mutation' as const, action: action.name, audit: { required: true, reasonRequired: true, expectedVersionRequired: false, idempotencyKeyRequired: true } })),
  ]);
  const app = new Hono<{ Variables: { accessIdentity: AccessIdentity; principal: AdminPrincipal; requestId: string } }>();
  app.use('*', async (c, next) => { await next(); c.res=new Response(c.res.body,c.res);setAdminSecurityHeaders(c.res.headers); });
  app.get('/health/live', c => c.json({ status: 'ok', scope: 'admin' }));
  app.use('*', async (c, next) => {
    const assertion = c.req.header('Cf-Access-Jwt-Assertion');
    if (!assertion) return c.json({ error: 'ADMIN_UNAUTHORIZED' }, 401);
    try {
      const identity = await accessVerifier.verify(assertion);
      const policy = policies.requirePolicy(c.req.method, c.req.path);
      if (policy.requestKind === 'mutation') assertMutationRequestSafety(c.req.raw);
      const resolved = resolvePrincipal ? await resolvePrincipal(identity) : principals.resolve(identity);
      const principal = authorizeIdentity(identity, { resolve: () => resolved }, policy.capability);
      c.set('accessIdentity', identity); c.set('principal', principal); c.set('requestId', crypto.randomUUID());
      await next();
    } catch (error) {
      if (error instanceof AdminSecurityError) {
        const status = error.code.startsWith('ACCESS_') ? 401 : 403;
        return c.json({ error: status === 401 ? 'ADMIN_UNAUTHORIZED' : 'ADMIN_FORBIDDEN' }, status);
      }
      if (error instanceof AdminHttpError) return c.json({ error: error.code }, error.status);
      return c.json({ error: 'ADMIN_UNAVAILABLE' }, 503);
    }
  });
  app.get('/', c => c.html(SHELL));
  for(const route of dependencies.extraReads??[])app.get(route.path,c=>route.execute(c.req.raw,c.get('principal').id,c.get('requestId')));
  for (const file of ['/assets/app.js', '/assets/app.css']) app.get(file, c => assets ? assets(c.req.raw) : c.json({ error: 'ADMIN_ASSET_UNAVAILABLE' }, 503));
  app.get('/api/admin/session', c => {
    const principal = c.get('principal');
    return c.json({ principalId: principal.id, principalKind: principal.externalIdentity.kind, capabilities: principal.capabilities });
  });
  app.get('/api/admin/v1/actions', c => c.json({ actions: actions.filter(action => c.get('principal').capabilities.includes(action.capability))
    .map(({ name, label, resource, fields, itemFields }) => ({ name, label, resource, fields, ...(itemFields ? { itemFields } : {}) })) }));
  app.get('/api/admin/v1/operation', async c => {
    const params = new URL(c.req.url).searchParams;
    const key = params.get('idempotencyKey');
    if (!key || key.length > 128 || [...params.keys()].some(k => k !== 'idempotencyKey')) return c.json({error:'ADMIN_QUERY_INVALID'},400);
    if (!dependencies.operationStatus) return c.json({error:'ADMIN_UNAVAILABLE'},503);
    return c.json(await dependencies.operationStatus(c.get('principal').id,key));
  });
  for (const resource of ADMIN_RESOURCES) app.get('/api/admin/v1/' + resource, async c => {
    const params=new URL(c.req.url).searchParams;
    if([...params.keys()].length!==new Set(params.keys()).size)return c.json({error:'ADMIN_QUERY_INVALID'},400);
    const query = AdminQuerySchema.safeParse(Object.fromEntries(params));
    if (!query.success) return c.json({ error: 'ADMIN_QUERY_INVALID' }, 400);
    if (!readResource) return c.json({ error: 'ADMIN_UNAVAILABLE' }, 503);
    return c.json(await readResource(resource, query.data));
  });
  for (const action of actions) app.post('/api/admin/v1/actions/' + action.name, async c => {
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.json({ error: 'ADMIN_BODY_REQUIRED' }, 400);
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength;
        if (length > 1024 * 1024) { await reader.cancel(); return c.json({ error: 'ADMIN_BODY_TOO_LARGE' }, 413); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let input: unknown; try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return c.json({ error: 'ADMIN_JSON_INVALID' }, 400); }
    return c.json(await action.execute(input, { principalId: c.get('principal').id, requestId: c.get('requestId'), authnContextSafeRef: await createAuthnContextSafeRef(c.get('accessIdentity')) }));
  });
  app.notFound(c => c.json({ error: 'ADMIN_FORBIDDEN' }, 403));
  app.onError((error, c) => error instanceof AdminHttpError ? c.json({ error: error.code }, error.status) : c.json({ error: 'ADMIN_UNAVAILABLE' }, 503));
  return app;
};
