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

type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, 'register'>;

const getServiceWorkerContainer = (): ServiceWorkerContainerLike | null => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker;
};

const WORKER_ACTIVATION_TIMEOUT_MS = 15_000;

/**
 * Wait on the registration's own worker lifecycle, not `container.ready`.
 * Arena pages live outside `/__web-package__/`, so `ready` (scope-matched to the
 * current URL) never settles there; the iframe URL alone is enough for the SW
 * to control subsequent instance fetches once activation completes.
 */
const waitForWorkerActive = async (registration: ServiceWorkerRegistration): Promise<void> => {
  const waitWorker = (worker: ServiceWorker | null | undefined): Promise<void> => {
    if (!worker) return Promise.resolve();
    if (worker.state === 'activated') return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        worker.removeEventListener('statechange', onChange);
        resolve();
      };
      const onChange = () => {
        if (worker.state === 'activated' || worker.state === 'redundant') finish();
      };
      const timer = setTimeout(finish, WORKER_ACTIVATION_TIMEOUT_MS);
      worker.addEventListener('statechange', onChange);
      // Re-check after subscribe in case state advanced between the guard and listener.
      if (worker.state === 'activated' || worker.state === 'redundant') finish();
    });
  };

  // A pending update must settle first even when the previous worker is already
  // activated; otherwise an in-flight install is never observed.
  const pending = registration.installing ?? registration.waiting;
  if (pending) await waitWorker(pending);
  if (registration.active) await waitWorker(registration.active);
};

export const ensureWebPackageServiceWorker = async (): Promise<void> => {
  const container = getServiceWorkerContainer();
  if (!container) throw new Error('当前环境不支持 Service Worker');
  const registration = await container.register(WEB_PACKAGE_SERVICE_WORKER_PATH, {
    scope: WEB_PACKAGE_SERVICE_WORKER_SCOPE,
  });
  await waitForWorkerActive(registration);
};

/**
 * Instances mounted in the current page session form a lease set; GC only drops
 * rows outside it so a second concurrent iframe survives the next mount.
 * A reload clears the in-memory set, reclaiming prior-session rows on first mount.
 */
const sessionLeaseInstanceIds = new Set<string>();

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
  sessionLeaseInstanceIds.add(instanceId);
  // Stale instances from prior reloads/history views are dropped so quota cannot grow unbounded.
  await gcWebPackageInstances([...sessionLeaseInstanceIds]);
  return buildWebPackageInstanceUrl(instanceId, snapshot.entry);
};

/** Optional release for explicit teardown; session-scoped leases otherwise clear on reload. */
export const releaseWebPackageInstanceLease = (instanceId: string): void => {
  sessionLeaseInstanceIds.delete(instanceId);
};

/**
 * All packages — builtin included — mount through the generic resource-space URL.
 * The Visual Novel srcdoc materializer remains a first-party fixture adapter only.
 */
export const renderWebPackageLocation = async (overlay: WebPackageOverlay): Promise<WebPackageRenderLocation> => {
  const url = await mountWebPackageInstance(overlay);
  return { kind: 'url', url };
};
