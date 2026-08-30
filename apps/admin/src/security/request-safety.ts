import { AdminSecurityError } from './errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const assertMutationRequestSafety = (request: Request): void => {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const requestOrigin = new URL(request.url).origin;
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  const valid = request.headers.get('Origin') === requestOrigin
    && request.headers.get('Sec-Fetch-Site') === 'same-origin'
    && request.headers.get('X-Mahoshojo-Admin-CSRF') === '1'
    && contentType === 'application/json';

  if (!valid) throw new AdminSecurityError('ADMIN_CSRF_REJECTED');
};
