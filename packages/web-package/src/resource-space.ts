import {
  WebPackagePathSchema,
  type WebPackageOverlay,
  type WebPackageRef,
} from '@mahoshojo/contracts/web-package';
import type { WebPackageManifest } from '@mahoshojo/contracts/web-package';

/** Narrow instance namespace; Service Worker (or an equivalent host) may only serve here. */
export const WEB_PACKAGE_INSTANCE_PREFIX = '/__web-package__/instance/';
export const WEB_PACKAGE_SERVICE_WORKER_PATH = '/__web-package__/sw.js';
export const WEB_PACKAGE_SERVICE_WORKER_SCOPE = '/__web-package__/';

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

export type WebPackageResourceFile = Readonly<{
  mediaType: string;
  bytes: Uint8Array;
}>;

export type WebPackageResourceSnapshot = Readonly<{
  instanceId: string;
  packageRef: WebPackageRef;
  entry: string;
  files: ReadonlyMap<string, WebPackageResourceFile>;
}>;

/** Minimal instance shape so resource-space does not import the package index (avoids cycles). */
export type WebPackageResourceSource = Readonly<{
  base: Readonly<{
    ref: WebPackageRef;
    manifest: WebPackageManifest;
    readFile: (_path: string) => Uint8Array | undefined;
  }>;
  overlay: WebPackageOverlay;
  readFile: (_path: string) => Uint8Array | undefined;
}>;

export const buildWebPackageInstanceUrl = (instanceId: string, path: string): string => {
  if (!INSTANCE_ID_PATTERN.test(instanceId)) throw new Error('非法 Web Package instance id');
  const parsed = WebPackagePathSchema.safeParse(path);
  if (!parsed.success) throw new Error('非法 Web Package 资源路径');
  // Segment-encode so reserved URL characters (notably '#') stay logical path bytes.
  const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `${WEB_PACKAGE_INSTANCE_PREFIX}${instanceId}/${encodedPath}`;
};

export const parseWebPackageInstancePath = (
  pathname: string,
): { instanceId: string; path: string } | null => {
  if (!pathname.startsWith(WEB_PACKAGE_INSTANCE_PREFIX)) return null;
  const rest = pathname.slice(WEB_PACKAGE_INSTANCE_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  const instanceId = rest.slice(0, slash);
  if (!INSTANCE_ID_PATTERN.test(instanceId)) return null;
  const rawPath = rest.slice(slash + 1);
  if (!rawPath) return null;
  try {
    const decoded = decodeURIComponent(rawPath);
    if (!WebPackagePathSchema.safeParse(decoded).success) return null;
    return { instanceId, path: decoded };
  } catch {
    return null;
  }
};

/**
 * Overlay[targetPath] wins over the immutable base file; every other path stays base.
 * Instance id is assigned by the host when the snapshot is materialized.
 */
export const createWebPackageResourceSnapshot = (
  instanceId: string,
  source: WebPackageResourceSource,
): WebPackageResourceSnapshot => {
  if (!INSTANCE_ID_PATTERN.test(instanceId)) throw new Error('非法 Web Package instance id');
  const { base, overlay } = source;
  if (
    base.ref.id !== overlay.packageRef.id
    || base.ref.version !== overlay.packageRef.version
    || base.ref.digest !== overlay.packageRef.digest
  ) {
    throw new Error('Web Package overlay 与冻结契约不匹配');
  }
  const files = new Map<string, WebPackageResourceFile>();
  for (const file of base.manifest.files) {
    const bytes = source.readFile(file.path);
    if (!bytes) throw new Error(`Web Package 文件不存在：${file.path}`);
    const mediaType = file.path === overlay.targetPath ? overlay.targetMediaType : file.mediaType;
    files.set(file.path, Object.freeze({ mediaType, bytes: bytes.slice() }));
  }
  // Legal overlays may create a target that never existed in the immutable base tree.
  if (!files.has(overlay.targetPath)) {
    const bytes = source.readFile(overlay.targetPath);
    if (!bytes) throw new Error(`Web Package overlay target 不存在：${overlay.targetPath}`);
    files.set(overlay.targetPath, Object.freeze({ mediaType: overlay.targetMediaType, bytes: bytes.slice() }));
  }
  return Object.freeze({
    instanceId,
    packageRef: Object.freeze({ ...base.ref }),
    entry: base.manifest.entry,
    files,
  });
};

export const resolveWebPackageInstancePath = (
  snapshot: WebPackageResourceSnapshot,
  pathname: string,
): WebPackageResourceFile | null => {
  const parsed = parseWebPackageInstancePath(pathname);
  if (!parsed || parsed.instanceId !== snapshot.instanceId) return null;
  return snapshot.files.get(parsed.path) ?? null;
};

const withCharset = (mediaType: string): string => {
  if (
    mediaType.startsWith('text/')
    || mediaType === 'application/json'
    || mediaType === 'image/svg+xml'
    || mediaType === 'application/javascript'
    || mediaType.endsWith('+json')
    || mediaType.endsWith('+xml')
  ) {
    return `${mediaType}; charset=utf-8`;
  }
  return mediaType;
};

export const createWebPackageResourceHeaders = (mediaType: string): Headers => {
  const headers = new Headers({
    'Content-Type': withCharset(mediaType),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  if (mediaType === 'text/html') {
    headers.set('Content-Security-Policy', 'sandbox allow-scripts');
  }
  return headers;
};

const notFound = (): Response => new Response('Not Found', {
  status: 404,
  headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  },
});

/** Generic resource-space response; unknown paths and foreign instance ids fail closed with 404. */
export const createWebPackageResourceResponse = (
  snapshot: WebPackageResourceSnapshot,
  pathname: string,
): Response => {
  const file = resolveWebPackageInstancePath(snapshot, pathname);
  if (!file) return notFound();
  return new Response(file.bytes.slice(), {
    status: 200,
    headers: createWebPackageResourceHeaders(file.mediaType),
  });
};
