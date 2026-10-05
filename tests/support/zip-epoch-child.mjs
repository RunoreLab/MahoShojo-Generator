/**
 * 跨时区 ZIP 打包门禁的子进程脚本（`tests/zip-epoch-timezone.test.ts` 的执行体）。
 *
 * 用法：`node zip-epoch-child.mjs <bundle.mjs>`。成功时 stdout 是一行 JSON，形如
 * `{"libraryArchive":"<sha256>","webPackageZip":"<sha256>"}`；失败时以非零码退出并把错误打到
 * stderr——父进程据此把失败原样暴露，而不是把"打包抛错"重述成一条含糊的断言失败。
 */
import { createHash } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const bundlePath = process.argv[2];
if (!bundlePath) {
  process.stderr.write('zip-epoch-child: missing bundle path\n');
  process.exit(2);
}

const {
  packLocalLibraryArchive,
  packWebPackageZip,
  verifyWebPackage,
  digestWebPackageBytes,
  ZIP_DOS_EPOCH,
} = await import(pathToFileURL(bundlePath).href);

const encoder = new TextEncoder();
const sha256Hex = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const digestOf = (hex) => `sha256:${hex}`;

// 纪元的本地时间分量**先**单独打一行。
//
// 顺序有意义：打包在下面，而打包本身可能因为纪元越界而抛错。若把纪元数据放在打包之后，
// 那么"某个调用点自写了错误纪元"这种注入会让这条输出整体消失——父进程只能报"读不到数据"，
// 而真正的信息（那个纪元读出来是什么）恰好是排障需要的。分成两行之后，即使打包失败，纪元
// 数据也已经交出去了。
process.stdout.write(`${JSON.stringify({
  epochLocalParts: {
    year: ZIP_DOS_EPOCH.getFullYear(),
    month: ZIP_DOS_EPOCH.getMonth(),
    day: ZIP_DOS_EPOCH.getDate(),
    hours: ZIP_DOS_EPOCH.getHours(),
    minutes: ZIP_DOS_EPOCH.getMinutes(),
    seconds: ZIP_DOS_EPOCH.getSeconds(),
  },
})}\n`);

// ---- 本地库 portable archive（`packages/local-library/src/archive-pack.ts`）----

const cardId = 'lc_0123456789abcdef0123456789abcdef';
const cardBytes = encoder.encode(JSON.stringify({ id: cardId, title: 'tz probe' }, null, 2));
const packageId = 'wp_0123456789abcdef0123456789abcdef';
const recordBytes = encoder.encode(JSON.stringify({ id: packageId }, null, 2));
const archiveBytes = encoder.encode('PKtz probe');
const archiveDigest = sha256Hex(archiveBytes);

const entries = new Map([
  [`cards/${cardId}.json`, cardBytes],
  [`web-packages/${packageId}.json`, recordBytes],
  [`archives/${archiveDigest}.zip`, archiveBytes],
]);

const packed = await packLocalLibraryArchive(
  {
    format: 'mahoshojo-local-library',
    formatVersion: 2,
    cardSchemaVersion: 1,
    webPackageSchemaVersion: 1,
    // 固定：本门禁只测"同一份常量 ⇒ 同一份字节"，测的是条目时间而不是清单字段的差异。
    exportedAt: '2026-01-01T00:00:00.000Z',
    cardCount: 1,
    webPackageCount: 1,
    cards: [
      {
        cardId,
        path: `cards/${cardId}.json`,
        contentDigest: digestOf('a'.repeat(64)),
        checksum: digestOf(sha256Hex(cardBytes)),
        byteLength: cardBytes.byteLength,
      },
    ],
    webPackages: [
      {
        packageId,
        path: `web-packages/${packageId}.json`,
        contentDigest: digestOf('b'.repeat(64)),
        checksum: digestOf(sha256Hex(recordBytes)),
        byteLength: recordBytes.byteLength,
        archivePath: `archives/${archiveDigest}.zip`,
        archiveDigest: digestOf(archiveDigest),
        archiveByteLength: archiveBytes.byteLength,
      },
    ],
  },
  async (entryPath) => {
    const bytes = entries.get(entryPath);
    if (!bytes) throw new Error(`missing entry: ${entryPath}`);
    return bytes;
  },
);

// ---- Web 包 ZIP（`packages/web-package/src/zip.ts`）----

const files = [
  { path: 'index.html', mediaType: 'text/html', bytes: encoder.encode('<!doctype html><title>tz probe</title>') },
  { path: 'styles/main.css', mediaType: 'text/css', bytes: encoder.encode('body{margin:0}') },
];
const base = await verifyWebPackage(
  {
    format: 'mahoshojo-web-package',
    formatVersion: 1,
    id: 'local.tz-probe',
    version: '1.0.0',
    name: 'TZ probe',
    entry: 'index.html',
    generation: { target: 'index.html', mediaType: 'text/html', mode: 'replace' },
    files: await Promise.all(
      files.map(async (file) => ({
        path: file.path,
        mediaType: file.mediaType,
        size: file.bytes.byteLength,
        digest: await digestWebPackageBytes(file.bytes),
      })),
    ),
  },
  files,
);
const webPackageZip = await packWebPackageZip(base);

process.stdout.write(`${JSON.stringify({
  libraryArchive: sha256Hex(packed.bytes),
  webPackageZip: sha256Hex(webPackageZip),
})}\n`);