import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestWebPackageBytes, packWebPackageZip, verifyWebPackage } from '@mahoshojo/web-package';

/** Synthetic bytes only; the fixture is verified but never executed. */
export async function arenaWebPackageFixture({ mediaType = 'application/json', version = '1.0.0', id = 'local.desktop-output' } = {}) {
  const extension = mediaType === 'application/json' ? 'json' : mediaType === 'text/css' ? 'css' : mediaType === 'text/javascript' ? 'js' : 'html';
  const target = `output.${extension}`;
  const files = [
    { path: 'index.html', mediaType: 'text/html', bytes: new TextEncoder().encode('<!doctype html><html><head><script src="./opaque.js"></script></head><body>immutable base</body></html>') },
    { path: 'opaque.js', mediaType: 'text/javascript', bytes: new TextEncoder().encode('globalThis.mustNeverExecute=true') },
    { path: 'unknown.bin', mediaType: 'application/octet-stream', bytes: new Uint8Array([0, 255, 11, 42]) },
    ...(mediaType === 'application/json' ? [{ path: 'schema.json', mediaType: 'application/json', bytes: new TextEncoder().encode('{"type":"object","required":["value"],"properties":{"value":{"type":"integer"}}}') }] : []),
  ];
  const base = await verifyWebPackage({ format: 'mahoshojo-web-package', formatVersion: 1, id, version, name: `本地 ${extension} 包`, entry: 'index.html', capabilities: [],
    generation: { target, mode: 'replace', mediaType, ...(mediaType === 'application/json' ? { schema: 'schema.json' } : {}) },
    files: await Promise.all(files.map(async (file) => ({ path: file.path, mediaType: file.mediaType, size: file.bytes.byteLength, digest: await digestWebPackageBytes(file.bytes) }))) }, files);
  const archive = await packWebPackageZip(base);
  const file = new File([archive.slice().buffer], `fixture-${version}.zip`, { type: 'application/zip' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => archive.slice().buffer });
  return { base, archive, file };
}

/** Fixed synthetic version 2 archive with a harmless root folder, to exercise normalization diagnostics. */
export function wrappedArenaWebPackageFile(): File {
  const wrapped = new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures/arena-web-package-wrapped.zip')));
  const file = new File([wrapped.slice().buffer], 'wrapped.zip', { type: 'application/zip' }); Object.defineProperty(file, 'arrayBuffer', { value: async () => wrapped.slice().buffer }); return file;
}
