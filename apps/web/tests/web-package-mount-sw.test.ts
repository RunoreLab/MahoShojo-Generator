import '@/tests/helpers/fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEB_PACKAGE_SERVICE_WORKER_PATH, WEB_PACKAGE_SERVICE_WORKER_SCOPE } from '@mahoshojo/web-package';
import { ensureWebPackageServiceWorker } from '@/lib/web-package/mount';
import { clearWebPackageInstances } from '@/lib/web-package/instance-store';

type MutableWorker = {
  state: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

const createWorker = (state: string): MutableWorker => ({
  state,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

const installRegistration = (registration: Partial<ServiceWorkerRegistration>) => {
  const container = {
    register: vi.fn(async () => registration as ServiceWorkerRegistration),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    get: () => container,
  });
  return container;
};

const findStateListener = (worker: MutableWorker) =>
  worker.addEventListener.mock.calls.find(([type]) => type === 'statechange')?.[1] as
    | ((...args: unknown[]) => void)
    | undefined;

describe('Web package service worker registration lifecycle', () => {
  beforeEach(async () => {
    await clearWebPackageInstances();
  });
  afterEach(async () => {
    await clearWebPackageInstances();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('awaits an installing worker through activation without container.ready', async () => {
    const installing = createWorker('installing');
    const active = createWorker('activated');
    const container = installRegistration({ active, installing: installing as unknown as ServiceWorker, waiting: null });
    const wait = ensureWebPackageServiceWorker();
    await vi.waitFor(() => expect(installing.addEventListener).toHaveBeenCalledWith('statechange', expect.any(Function)));
    const listener = findStateListener(installing);
    expect(listener).toBeTypeOf('function');
    installing.state = 'activated';
    listener!();
    await wait;
    expect(container.register).toHaveBeenCalledWith(WEB_PACKAGE_SERVICE_WORKER_PATH, {
      scope: WEB_PACKAGE_SERVICE_WORKER_SCOPE,
    });
    expect(installing.removeEventListener).toHaveBeenCalledWith('statechange', listener);
  });

  it('treats a redundant installing worker as a finished wait', async () => {
    const installing = createWorker('installing');
    const active = createWorker('activated');
    installRegistration({ active, installing: installing as unknown as ServiceWorker, waiting: null });
    const wait = ensureWebPackageServiceWorker();
    await vi.waitFor(() => expect(installing.addEventListener).toHaveBeenCalledWith('statechange', expect.any(Function)));
    const listener = findStateListener(installing);
    installing.state = 'redundant';
    listener!();
    await expect(wait).resolves.toBeUndefined();
    expect(installing.removeEventListener).toHaveBeenCalledWith('statechange', listener);
  });

  it('resolves immediately when registration already has an activated worker', async () => {
    const active = createWorker('activated');
    installRegistration({ active: active as unknown as ServiceWorker, installing: null, waiting: null });
    await ensureWebPackageServiceWorker();
    expect(active.addEventListener).not.toHaveBeenCalled();
  });
});
