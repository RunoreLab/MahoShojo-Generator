import {
  createWebPackageResourceResponse,
  parseWebPackageInstancePath,
  WEB_PACKAGE_INSTANCE_PREFIX,
} from '@mahoshojo/web-package';
import { readWebPackageInstance } from './instance-store';

const notFound = (): Response => new Response('Not Found', {
  status: 404,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'text/plain; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  },
});

/**
 * Generic resource-space handler shared by the Service Worker and unit tests.
 * Unknown instance ids, non-instance paths and missing files all fail closed with 404.
 */
export const handleWebPackageResourceRequest = async (pathname: string): Promise<Response> => {
  if (!pathname.startsWith(WEB_PACKAGE_INSTANCE_PREFIX)) return notFound();
  const parsed = parseWebPackageInstancePath(pathname);
  if (!parsed) return notFound();
  const snapshot = await readWebPackageInstance(parsed.instanceId);
  if (!snapshot) return notFound();
  return createWebPackageResourceResponse(snapshot, pathname);
};
