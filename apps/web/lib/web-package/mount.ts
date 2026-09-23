import {
  WEB_PACKAGE_SERVICE_WORKER_PATH,
  WEB_PACKAGE_SERVICE_WORKER_SCOPE,
  buildWebPackageInstanceUrl,
  createWebPackageResourceSnapshot,
  isBuiltinWebPackageRef,
  renderWebPackage,
  resolveWebPackage,
  createWebPackageInstance,
} from '@mahoshojo/web-package';
import type { WebPackageOverlay, WebPackageRenderLocation } from '@mahoshojo/contracts/web-package';
import { putWebPackageInstance } from './instance-store';

type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, 'register' | 'ready' | 'controller' | 'addEventListener' | 'removeEventListener'>;

const getServiceWorkerContainer = (): ServiceWorkerContainerLike | null => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker;
};

const waitForController = async (container: ServiceWorkerContainerLike): Promise<void> => {
  if (container.controller) return;
  await new Promise<void>((resolve) => {
    const onChange = () => {
      container.removeEventListener('controllerchange', onChange);
      resolve();
    };
    container.addEventListener('controllerchange', onChange);
    // Fallback: iframe may still hit an already-active worker after ready.
    setTimeout(() => {
      container.removeEventListener('controllerchange', onChange);
      resolve();
    }, 2_000);
  });
};

export const ensureWebPackageServiceWorker = async (): Promise<void> => {
  const container = getServiceWorkerContainer();
  if (!container) throw new Error('当前环境不支持 Service Worker');
  await container.register(WEB_PACKAGE_SERVICE_WORKER_PATH, { scope: WEB_PACKAGE_SERVICE_WORKER_SCOPE });
  await container.ready;
  await waitForController(container);
};

/** Current-session instance materialization into the narrow URL namespace. */
export const mountWebPackageInstance = async (overlay: WebPackageOverlay): Promise<string> => {
  const base = await resolveWebPackage(overlay.packageRef);
  const instance = await createWebPackageInstance(base, overlay);
  const instanceId = crypto.randomUUID().replace(/[^A-Za-z0-9_-]/gu, '');
  const snapshot = createWebPackageResourceSnapshot(instanceId, instance);
  await putWebPackageInstance(snapshot);
  await ensureWebPackageServiceWorker();
  return buildWebPackageInstanceUrl(instanceId, snapshot.entry);
};

/**
 * Builtin Visual Novel Lite keeps the first-party srcdoc materializer as an adapter.
 * Arbitrary packages mount into the generic resource-space URL namespace.
 */
export const renderWebPackageLocation = async (overlay: WebPackageOverlay): Promise<WebPackageRenderLocation> => {
  if (isBuiltinWebPackageRef(overlay.packageRef)) {
    return renderWebPackage(overlay);
  }
  const url = await mountWebPackageInstance(overlay);
  return { kind: 'url', url };
};
