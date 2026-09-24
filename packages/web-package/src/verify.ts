import {
  WebPackageManifestSchema,
  type WebPackageManifest,
  type WebPackageRef,
} from '@mahoshojo/contracts/web-package';

const encoder = new TextEncoder();

export const digestWebPackageBytes = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/** UTF-8 canonical JSON: recursively sorted keys, sorted file paths and capabilities, no whitespace. */
export const canonicalizeWebPackageManifest = (input: unknown): string => {
  const manifest = WebPackageManifestSchema.parse(input);
  return stableJson({ ...manifest, capabilities: [...manifest.capabilities].sort(), files: [...manifest.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
};

export const freezeDeep = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
};

export type VerifiedWebPackage = Readonly<{
  ref: Readonly<WebPackageRef>;
  manifest: WebPackageManifest;
  readFile: (_path: string) => Uint8Array | undefined;
}>;

/** Verification only; Phase 1 does not expose an arbitrary package import or registry API. */
export const verifyWebPackage = async (
  input: unknown,
  files: ReadonlyArray<Readonly<{ path: string; bytes: Uint8Array }>>,
): Promise<VerifiedWebPackage> => {
  const manifest = WebPackageManifestSchema.parse(input);
  if (files.length !== manifest.files.length) throw new Error('Web Package 文件集合不匹配');
  const payloads = new Map<string, Uint8Array>();
  for (const file of files) {
    if (payloads.has(file.path)) throw new Error('Web Package 文件路径重复');
    payloads.set(file.path, new Uint8Array(file.bytes));
  }
  for (const file of manifest.files) {
    const bytes = payloads.get(file.path);
    if (!bytes || bytes.byteLength !== file.size || await digestWebPackageBytes(bytes) !== file.digest) {
      throw new Error(`Web Package 文件完整性校验失败：${file.path}`);
    }
  }
  const ref = freezeDeep({ id: manifest.id, version: manifest.version, digest: await digestWebPackageBytes(encoder.encode(canonicalizeWebPackageManifest(manifest))) });
  return Object.freeze({ ref, manifest: freezeDeep(manifest), readFile: (path: string) => payloads.get(path)?.slice() });
};
