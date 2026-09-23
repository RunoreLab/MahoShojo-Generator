import {
  WEB_PACKAGE_SERVICE_WORKER_PATH,
  WEB_PACKAGE_SERVICE_WORKER_SCOPE,
  buildWebPackageInstanceUrl,
  createWebPackageResourceSnapshot,
  digestWebPackageBytes,
  resolveWebPackage,
  createWebPackageInstance,
} from '@mahoshojo/web-package';
import type { WebPackageOverlay, WebPackageRenderLocation } from '@mahoshojo/contracts/web-package';
import { gcWebPackageInstances, putWebPackageInstance } from './instance-store';

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

/** Deterministic id so remounting the same overlay reuses one IndexedDB row. */
const stableInstanceId = async (overlay: WebPackageOverlay): Promise<string> => {
  const material = [
    overlay.packageRef.digest,
    overlay.targetPath,
    overlay.targetMediaType,
    overlay.generatedDigest,
  ].join('\n');
  const digest = await digestWebPackageBytes(new TextEncoder().encode(material));
  return `inst_${digest.slice('sha256:'.length, 'sha256:'.length + 40)}`;
};

/** Current-session instance materialization into the narrow URL namespace. */
export const mountWebPackageInstance = async (overlay: WebPackageOverlay): Promise<string> => {
  const base = await resolveWebPackage(overlay.packageRef);
  const instance = await createWebPackageInstance(base, overlay);
  const instanceId = await stableInstanceId(overlay);
  const snapshot = createWebPackageResourceSnapshot(instanceId, instance);
  await putWebPackageInstance(snapshot);
  await ensureWebPackageServiceWorker();
  // Stale instances from prior reloads/history views are dropped so quota cannot grow unbounded.
  await gcWebPackageInstances([instanceId]);
  return buildWebPackageInstanceUrl(instanceId, snapshot.entry);
};

/**
 * All packages — builtin included — mount through the generic resource-space URL.
 * The Visual Novel srcdoc materializer remains a first-party fixture adapter only.
 */
export const renderWebPackageLocation = async (overlay: WebPackageOverlay): Promise<WebPackageRenderLocation> => {
  const url = await mountWebPackageInstance(overlay);
  return { kind: 'url', url };
};
