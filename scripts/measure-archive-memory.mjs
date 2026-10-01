/**
 * D2.3b 归档内存实测（`DESK-070`）。
 *
 * `DESK-070` 要求归档级字节上限**由实测推导**，而不是拍脑袋；本脚本就是那个实测的可重复入口。
 * 它在合成库上跑真实的 `packLocalLibraryArchive`，记录输入字节数、输出归档字节数，以及打包
 * 进程的常驻内存峰值。
 *
 * 测的是**打包输入**上限（`MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES`）。最终归档文件长度是另一个
 * 上限：ZIP 有 local header、central directory 与 EOCD 开销，两者不相等。本脚本同时打印两者，
 * 使下一次改档时能看到差额有多大。
 *
 * 用法：
 *   node --experimental-strip-types scripts/measure-archive-memory.mjs
 *   node --experimental-strip-types scripts/measure-archive-memory.mjs 64 8   # 64 MiB × 8 个包
 *
 * ## 为什么每个档位都跑在**独立子进程**里
 *
 * V8 不会及时把已释放的大块内存还给 OS，所以同一进程里跑完 480 MiB 再跑 512 MiB 时，第二次的
 * RSS 基线已经被第一次抬高了。差值法在这种情况下测出的是 0——一个看起来"内存占用与库大小无关"
 * 的结论。基线只能来自一个干净进程。
 *
 * ## 测的是什么、不测什么
 *
 * 测：打包进程的 RSS 峰值（来源字节 + 压缩过程副本 + 输出归档），以及输出归档的字节数。
 *
 * 不测：Desktop WebView 里的渲染层。两者是不同的 V8，但跑同一份打包产物，因此分配形态可比；
 * 真实 WebView 的绝对数字会因平台与版本而异，**必须**在真机上复核一次再定档。native 侧不参与
 * 归档组装（`DESK-059`），它的峰值是"写文件时再持有一份归档字节"，即输出字节数。
 *
 * 输出是**证据**，不是门禁。它不进 CI：内存数字随 Node/V8 版本漂移，做成断言只会得到一条经常
 * 误报的检查。上限因此写死在 `archive-pack.ts` 里；变更时重跑本脚本，把数字写进提交说明。
 */
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
/** 从 local-library 的位置解析依赖——根目录与该包的 fflate 版本可能不同。 */
const requireLibrary = createRequire(
  new URL('../packages/local-library/src/archive-pack.ts', import.meta.url),
);
const ARCHIVE_PACK_ENTRY = new URL('../packages/local-library/src/archive-pack.ts', import.meta.url);
const SELF = fileURLToPath(import.meta.url);

const CHILD_FLAG = '--child';
const RESULT_PREFIX = 'ARCHIVE_MEASURE ';

/**
 * 把 `archive-pack.ts` 打成一份临时 ESM 再导入。
 *
 * 为什么不直接 `import`：包内源码用**无扩展名**的相对导入（bundler 风格），Node 的 ESM 解析器
 * 要求显式扩展名，直接加载会 `ERR_MODULE_NOT_FOUND`。
 *
 * 为什么不把代码复制进脚本：复制会让实测**测的不是生产代码**，而实测的全部价值就在于它测的
 * 就是那份代码。esbuild 已在 devDependencies 里，用它打包既让工具免于依赖 tsx 或 vitest，
 * 又保证被测对象与仓库里逐字相同。fflate 一并打进去，避免临时目录里出现悬空依赖解析。
 */
const loadPacker = async () => {
  const esbuild = requireLibrary('esbuild');
  const dir = await mkdtemp(path.join(tmpdir(), 'mahoshojo-archive-measure-'));
  const outFile = path.join(dir, 'archive-pack.mjs');
  await esbuild.build({
    entryPoints: [fileURLToPath(ARCHIVE_PACK_ENTRY)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: `node${process.versions.node.split('.')[0]}`,
    outfile: outFile,
    logLevel: 'silent',
  });
  return {
    module: await import(pathToFileURL(outFile).href),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
};

/** 合成 Web 包 ZIP：xorshift32 随机字节，保证不可压缩，模拟真实的 HTML/JS/图片载荷。 */
const makeArchiveBytes = (mib) => {
  const total = Math.round(mib * 1024 * 1024);
  const bytes = new Uint8Array(total);
  let state = 0x9e3779b9;
  for (let i = 0; i < total; i += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    bytes[i] = state & 0xff;
  }
  return bytes;
};

/**
 * 由整数种子展开成 64 位十六进制。
 *
 * 刻意**不**用 `seed.toString(16).padStart(64, '0')`：那样 60 个包会得到 60 个只在末尾几位不同的
 * 摘要，而 id 由摘要**前 32 位**派生——所有包的 id 完全相同，合成库被清单的唯一性检查直接拒绝。
 * （这个 bug 真发生过一次，正好说明那条检查有用。）
 */
const hex = (seed) => {
  let state = (seed + 0x9e3779b9) >>> 0;
  let out = '';
  while (out.length < 64) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    out += ((t ^ (t >>> 14)) >>> 0).toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
};

const digestOf = (seed) => `sha256:${hex(seed)}`;

const buildLibrary = ({ packageCount, packageMib, cardCount }) => {
  const entries = new Map();
  const cards = [];
  const webPackages = [];

  for (let i = 0; i < cardCount; i += 1) {
    const id = `lc_${hex(i + 1).slice(0, 32)}`;
    const record = {
      id,
      schemaVersion: 1,
      storageLocation: 'local',
      cardType: 'character',
      title: `card ${i}`,
      data: { name: `x${i}`, tags: ['a', 'b'], note: 'a'.repeat(400) },
      contentDigest: digestOf(i + 1),
      provenance: { kind: 'unsigned' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const bytes = new TextEncoder().encode(JSON.stringify(record, null, 2));
    const entryPath = `cards/${id}.json`;
    entries.set(entryPath, bytes);
    cards.push({
      cardId: id,
      path: entryPath,
      contentDigest: record.contentDigest,
      checksum: digestOf(i + 1_000),
      byteLength: bytes.byteLength,
    });
  }

  for (let i = 0; i < packageCount; i += 1) {
    const contentDigest = digestOf(i + 10_000);
    const packageId = `wp_${contentDigest.slice(7, 39)}`;
    const archiveDigest = digestOf(i + 20_000);
    const archiveBytes = makeArchiveBytes(packageMib);
    const record = {
      id: packageId,
      schemaVersion: 1,
      storageLocation: 'local',
      entityKind: 'web-package',
      title: `package ${i}`,
      summary: `local.test@1.0.${i}`,
      ref: { id: 'local.test', version: `1.0.${i}`, digest: contentDigest },
      manifest: {
        format: 'mahoshojo-web-package',
        formatVersion: 1,
        id: 'local.test',
        version: `1.0.${i}`,
        name: `package ${i}`,
        entry: 'index.html',
        generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' },
        capabilities: ['scripts'],
        files: [{ path: 'index.html', mediaType: 'text/html', digest: contentDigest, size: 12 }],
      },
      contentDigest,
      archiveByteLength: archiveBytes.byteLength,
      provenance: { kind: 'unsigned', execution: 'imported' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const recordBytes = new TextEncoder().encode(JSON.stringify(record, null, 2));
    const recordPath = `web-packages/${packageId}.json`;
    const archivePath = `archives/${archiveDigest.slice(7)}.zip`;
    entries.set(recordPath, recordBytes);
    entries.set(archivePath, archiveBytes);
    webPackages.push({
      packageId,
      path: recordPath,
      contentDigest,
      checksum: digestOf(i + 30_000),
      byteLength: recordBytes.byteLength,
      archivePath,
      archiveDigest,
      archiveByteLength: archiveBytes.byteLength,
    });
  }

  return {
    manifest: {
      format: 'mahoshojo-local-library',
      formatVersion: 2,
      cardSchemaVersion: 1,
      webPackageSchemaVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      cardCount: cards.length,
      webPackageCount: webPackages.length,
      cards,
      webPackages,
    },
    entries,
  };
};

/** 单个档位，在**干净进程**里跑完并把结果作为一行 JSON 交回父进程。 */
const runChild = async (config) => {
  // 用 `process.resourceUsage().maxRSS` 而不是 `process.memoryUsage().rss`：
  // 合成来源字节与 `zipSync` 都是**同步**的 CPU+分配工作，期间事件循环被占满，setInterval
  // 永远不会触发——采样器因此会在最危险的时刻缺席（早先的版本正是这样测出 0.10× 的荒谬结果）。
  // maxRSS 是 OS 维护的高水位，同步峰值也逃不掉。
  const baselineMaxRss = process.resourceUsage().maxRSS * 1024;
  const { module: packer, cleanup } = await loadPacker();
  try {
    const { manifest, entries } = buildLibrary(config);
    const afterSourceMaxRss = process.resourceUsage().maxRSS * 1024;
    const started = process.hrtime.bigint();
    const packed = await packer.packLocalLibraryArchive(manifest, async (entryPath) => {
      const bytes = entries.get(entryPath);
      if (!bytes) throw new Error(`missing entry: ${entryPath}`);
      return bytes;
    }, { maxTotalBytes: Number.MAX_SAFE_INTEGER });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
      baselineMaxRss,
      afterSourceMaxRss,
      peakMaxRss: process.resourceUsage().maxRSS * 1024,
      inputBytes: packed.totalByteLength,
      archiveBytes: packed.bytes.byteLength,
      elapsedMs,
      entryCount: packed.entryCount,
      capBytes: packer.MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES,
    })}\n`);
  } finally {
    await cleanup();
  }
};

const LADDER = [
  { label: '8 MiB x 60', packageMib: 8, packageCount: 60, cardCount: 200 },
  { label: '16 MiB x 30', packageMib: 16, packageCount: 30, cardCount: 200 },
  { label: '64 MiB x 8', packageMib: 64, packageCount: 8, cardCount: 200 },
];

const toMiB = (bytes) => bytes / 1024 / 1024;
const pad = (value) => value.toFixed(1).padStart(8);

const runParent = async (custom) => {
  const steps = custom
    ? [{ label: `${custom.packageMib} MiB x ${custom.packageCount}`, ...custom }]
    : LADDER;

  const { module: packerProbe } = await loadPacker();
  await packerProbe.MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES;
  console.log(`# node ${process.version}  fflate=${requireLibrary('fflate/package.json').version}`);
  console.log('# 每个档位跑在独立子进程里；峰值取 OS 维护的 maxRSS 高水位（同步峰值也逃不掉）\n');
  console.log(
    `${'档位'.padEnd(14)}${'输入'.padStart(11)}${'归档'.padStart(11)}${'进程基线'.padStart(11)}`
    + `${'来源后'.padStart(11)}${'峰值'.padStart(11)}${'净增'.padStart(10)}${'倍数'.padStart(8)}${'耗时'.padStart(10)}`,
  );

  const results = [];
  for (const step of steps) {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--experimental-strip-types', SELF, CHILD_FLAG, String(step.packageMib), String(step.packageCount), String(step.cardCount)],
      { maxBuffer: 1024 * 1024 * 32 },
    );
    const line = stdout.split('\n').find((candidate) => candidate.startsWith(RESULT_PREFIX));
    if (!line) throw new Error(`child produced no result for ${step.label}:\n${stdout}`);
    const parsed = JSON.parse(line.slice(RESULT_PREFIX.length));
    results.push({ step, ...parsed });
    const net = parsed.peakMaxRss - parsed.baselineMaxRss;
    console.log(
      `${step.label.padEnd(14)}`
      + `${pad(toMiB(parsed.inputBytes))} MiB`
      + `${pad(toMiB(parsed.archiveBytes))} MiB`
      + `${pad(toMiB(parsed.baselineMaxRss))} MiB`
      + `${pad(toMiB(parsed.afterSourceMaxRss))} MiB`
      + `${pad(toMiB(parsed.peakMaxRss))} MiB`
      + `${pad(toMiB(net))} MiB`
      + `${(parsed.peakMaxRss / parsed.inputBytes).toFixed(2).padStart(7)}×`
      + `${`${Math.round(parsed.elapsedMs)} ms`.padStart(10)}`,
    );
  }

  const worst = results.reduce((a, b) => (a.peakMaxRss > b.peakMaxRss ? a : b));
  const capBytes = worst.capBytes;
  const ratio = worst.peakMaxRss / worst.inputBytes;
  const netRatio = (worst.peakMaxRss - worst.baselineMaxRss) / worst.inputBytes;
  console.log('\n# 读法');
  console.log(`峰值/输入 = ${ratio.toFixed(2)}×，净增/输入 = ${netRatio.toFixed(2)}×`
    + '（含来源字节 + 压缩过程副本 + 输出归档）');
  console.log(`按峰值倍数，上限 ${Math.round(toMiB(capBytes))} MiB 的归档在打包进程里峰值 ≈ `
    + `${Math.round(toMiB(ratio * capBytes))} MiB RSS。`);
  console.log(`native 写文件时另持有一份归档字节，渲染层与 native 合计 ≈ `
    + `${Math.round(toMiB(ratio * capBytes + capBytes))} MiB。`);
  console.log('外层 ZIP 里 Web 包为 store，压缩比≈1 是预期结果，不是缺陷。');
  // 输入预算不等于最终归档文件大小：ZIP 有 local header、central directory 与 EOCD 开销。
  // 这个差额决定了输出上限与输入上限之间必须留多少余量，因此每次改档都把它打出来。
  const overheadRatio = worst.archiveBytes / worst.inputBytes;
  console.log(`归档输出/输入 = ${overheadRatio.toFixed(4)}×（ZIP 容器开销）；`
    + `按此比例，${Math.round(toMiB(capBytes))} MiB 输入上限对应的输出归档 ≈ `
    + `${Math.round(toMiB(overheadRatio * capBytes))} MiB。`);
  console.log('下一步必须在真机 WebView 里复核渲染层绝对值，再决定是否需要流式组装。');
};

const args = process.argv.slice(2);
if (args[0] === CHILD_FLAG) {
  await runChild({
    packageMib: Number(args[1]),
    packageCount: Number(args[2]),
    cardCount: Number(args[3]),
  });
} else {
  const [mibArg, countArg] = args;
  await runParent(
    mibArg && countArg
      ? { packageMib: Number(mibArg), packageCount: Number(countArg), cardCount: 200 }
      : null,
  );
}
