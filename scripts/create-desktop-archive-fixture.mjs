/**
 * 真机验收用 portable V2 归档，全部内容为合成数据，不读写真实本地库。
 * 用法：node scripts/create-desktop-archive-fixture.mjs 1|64|128|248
 * 档位指不可压缩 bin 载荷的 MiB；实际 ZIP 大小包含清单、记录和头部开销。
 * 每次在 .tmp 内创建独立目录，不覆盖既有文件。大档会占用明显高于载荷的内存。
 * 此脚本只证明生产 collect/pack/inspect 能接受夹具，不代替 WebView/raw IPC 真机测量。
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mib = Number(process.argv[2]);
if (process.argv.length !== 3 || ![1, 64, 128, 248].includes(mib)) {
  throw new Error('用法：node scripts/create-desktop-archive-fixture.mjs 1|64|128|248');
}
const requireLibrary = createRequire(new URL('../packages/local-library/package.json', import.meta.url));
const { build } = requireLibrary('esbuild');
const temporaryRoot = path.join(root, '.tmp');
await mkdir(temporaryRoot, { recursive: true });
const directory = await mkdtemp(path.join(temporaryRoot, 'desktop-archive-fixture-'));
const bundlePath = path.join(directory, 'fixture-runtime.mjs');
const outputPath = path.join(directory, `synthetic-${mib}MiB.zip`);

try {
  // 只通过 package 的显式 exports 使用真实生产实现；临时 bundle 解决无扩展名 TS 导入。
  await build({
    stdin: {
      contents: `
        export { collectLocalLibraryArchive } from '@mahoshojo/local-library/archive-export';
        export { packLocalLibraryArchive } from '@mahoshojo/local-library/archive-pack';
        export { inspectLocalLibraryArchive } from '@mahoshojo/local-library/archive-import';
        export { LocalWebPackageRecordV1Schema, deriveLocalWebPackageId } from '@mahoshojo/local-library/web-package-record';
        export { verifyWebPackage, packWebPackageZip, digestWebPackageBytes } from '@mahoshojo/web-package';
      `,
      resolveDir: path.join(root, 'packages/local-library'),
      sourcefile: 'desktop-archive-fixture-entry.mjs',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: `node${process.versions.node.split('.')[0]}`,
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const runtime = await import(pathToFileURL(bundlePath).href);
  const timestamp = new Date().toISOString();
  const encoder = new TextEncoder();
  const packages = [];
  const archives = new Map();
  const maxPackageBytes = 8 * 1024 * 1024;
  // 留出内层 ZIP 与清单余量，并在真实打包后再次检查 8 MiB 上限。
  const payloadPerPackage = maxPackageBytes - 64 * 1024;
  let remaining = mib * 1024 * 1024;
  while (remaining > 0) {
    const index = packages.length + 1;
    const size = Math.min(remaining, payloadPerPackage);
    const files = [
      {
        path: 'index.html',
        mediaType: 'text/html',
        bytes: encoder.encode(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>合成验收包 ${index}</title><body><h1>合成验收包 ${index}</h1><p>仅用于本地归档验收，无脚本与网络请求。</p></body></html>`),
      },
      { path: 'payload.bin', mediaType: 'application/octet-stream', bytes: randomBytes(size) },
    ];
    const manifest = {
      format: 'mahoshojo-web-package',
      formatVersion: 1,
      id: 'local.desktop-acceptance',
      version: `1.0.${index}`,
      name: `合成验收包 ${index}`,
      entry: 'index.html',
      generation: { target: 'index.html', mediaType: 'text/html', mode: 'replace' },
      files: await Promise.all(files.map(async ({ path: filePath, mediaType, bytes }) => ({
        path: filePath, mediaType, size: bytes.byteLength,
        digest: await runtime.digestWebPackageBytes(bytes),
      }))),
    };
    const verified = await runtime.verifyWebPackage(manifest, files);
    const bytes = await runtime.packWebPackageZip(verified);
    if (bytes.byteLength > maxPackageBytes) throw new Error('内层 Web 包超过 8 MiB');
    const record = runtime.LocalWebPackageRecordV1Schema.parse({
      id: runtime.deriveLocalWebPackageId(verified.ref.digest),
      schemaVersion: 1,
      storageLocation: 'local',
      entityKind: 'web-package',
      title: manifest.name,
      summary: '纯合成数据：Desktop portable archive 真机验收',
      ref: verified.ref,
      manifest: verified.manifest,
      contentDigest: verified.ref.digest,
      archiveByteLength: bytes.byteLength,
      provenance: { kind: 'unsigned', execution: 'imported' },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    packages.push(record);
    archives.set(record.id, bytes);
    remaining -= size;
  }
  // 全部记录共享 timestamp，依 source 的 (updatedAt, id) 升序契约按 id 排列。
  packages.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const emptyPage = async () => ({ items: [], nextCursor: null });
  const collected = await runtime.collectLocalLibraryArchive({
    listCards: emptyPage,
    listWebPackages: async () => ({ items: packages, nextCursor: null }),
    readWebPackageArchive: async (id) => {
      const bytes = archives.get(id);
      if (!bytes) throw new Error(`缺少合成包 ${id}`);
      return bytes;
    },
  }, { exportedAt: timestamp });
  const packed = await runtime.packLocalLibraryArchive(collected.manifest, collected.read);
  // inspect 只需要列表读取，写入接口不提供；绝不调用 apply 或连接真实库。
  const plan = await runtime.inspectLocalLibraryArchive({
    cards: { list: emptyPage }, packages: { list: emptyPage },
  }, packed.bytes);
  await writeFile(outputPath, packed.bytes, { flag: 'wx' });
  console.log(JSON.stringify({
    outputPath,
    payloadBytes: mib * 1024 * 1024,
    inputBytes: packed.totalByteLength,
    archiveBytes: packed.bytes.byteLength,
    entryCount: packed.entryCount,
    cardCount: plan.summary.cardCount,
    webPackageCount: plan.summary.webPackageCount,
    archiveDigest: await runtime.digestWebPackageBytes(packed.bytes),
    inspected: true,
  }, null, 2));
} finally {
  await unlink(bundlePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
