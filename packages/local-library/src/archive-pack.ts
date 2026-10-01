import { zipSync, type Zippable } from 'fflate';
import { ZIP_DOS_EPOCH } from '@mahoshojo/contracts/zip';

import {
  LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH,
  type LocalLibraryArchiveManifestV2,
  LocalLibraryArchiveManifestV2Schema,
  localLibraryArchiveWebPackageArchivePath,
} from './archive';

/**
 * 组装 portable archive 的机制层。
 *
 * ## 为什么 ZIP 在这里而不在 native
 *
 * `DESK-059` 与 `ADR-desktop-tauri-v1` 第 7 条要求归档的业务语义归 TS 权威实现所有，native 只提供
 * SQLite/blob 机制。ZIP 封装是业务语义的一部分（它决定跨 runtime 的字节兼容），因此必须在 TS；
 * native 仅负责把**最终字节**写到 `<data_root>/exports/` 下某个由它自己挑的名字。
 *
 * ## 为什么外层 ZIP 里的 Web 包**不再压缩**
 *
 * `archives/*.zip` 以 `level: 0`（store）写入。它们已经是 DEFLATE 压缩过的 ZIP，再压一遍既不省
 * 体积又实打实烧 CPU——对一个几百 MiB 的库，这是导出耗时里最大的一块无谓开销。记录 JSON
 * （`manifest.json`、`cards/*.json`、`web-packages/*.json`）仍然压缩，它们是纯文本。
 *
 * ## 确定性到底保证什么
 *
 * 固定条目时间 + 固定条目顺序 + 固定的清单字节 ⇒ **在给定 `exportedAt` 的前提下**，同一份库两次
 * 导出产出逐字节相同的归档。这让归档自身的摘要可被断言与比对，也让"导出逻辑是否变了"有一个可验证
 * 的答案。
 *
 * **限定条件是 `exportedAt`，不是"打包器忽略时间"。** `manifest.json` 就是 `manifest` 的
 * `JSON.stringify`，而 `exportedAt` 是它的必填字段，因此它必然进入字节。改它就改归档摘要。
 * 这一点此前被写成"`exportedAt` 刻意不参与字节布局"，与实现相反，也与
 * `archive-pack.test.ts` 里那条 deterministic 测试的通过方式一致——夹具把 `exportedAt` 钉死成
 * 了同一个值，于是"忽略时间"从未被真正检验。
 *
 * 所以调用方想要的是哪一个，必须自己选：
 *
 * - 想知道"这份库的内容变了没有" → 比较各记录的 `contentDigest` / `archiveDigest`，**不要**比较
 *   整个归档的字节摘要；
 * - 想知道"打包逻辑变了没有" → 在夹具里固定 `exportedAt`，比较归档字节。
 *
 * ZIP 条目里没有真实导出时间是刻意的代价：那个时间在 `manifest.exportedAt` 里，而它必须可读、
 * 必须对导入方可见，因此不能为了字节稳定而从归档里抹掉。
 */

/**
 * 固定条目时间让打包输出可复现。
 *
 * 纪元的构造方式（本地时间 vs UTC 字面量）不是风格问题：在 UTC 以西的时区，UTC 字面量会让
 * `zipSync` 直接抛 `date not in range 1980-2099`。理由与实测见 {@link ZIP_DOS_EPOCH}。
 */
const ZIP_MTIME = ZIP_DOS_EPOCH;

/** 记录 JSON 的压缩级别。沿用 `packWebPackageZip` 的 6，避免同一仓库出现两套级别。 */
const RECORD_DEFLATE_LEVEL = 6;

/**
 * **打包输入**字节上限：manifest 字节 + 全部未压缩载荷的声明长度之和，读取后再核对累计。
 *
 * 名字里的"输入"是刻意的（`DESK-070`）。此前它叫 `MAX_LOCAL_LIBRARY_ARCHIVE_BYTES`——一个
 * 名字覆盖三件不同的事，而它们的上限来源与失败后果都不同：
 *
 * - 本常量：打包输入预算，由内存实测推导；
 * - 最终归档文件长度：`zipSync` 之后**另有**一次断言，ZIP 有 local header、central directory
 *   与 EOCD 开销，条目多时输入预算不等于输出文件大小；
 * - 单次 raw IPC 块大小（仅 Desktop）。
 *
 * 三者 `MUST NOT` 互相充当。前者已实现，后两者是 D2.3b2 的工作。
 *
 * 与 `MAX_BLOB_BYTES`（单个 blob 的 64 MiB）**无关**：一个含几十个 Web 包的归档轻松超过它，而每个
 * 包都远小于 64 MiB（`DESK-070`）。
 *
 * 数字来自 `scripts/measure-archive-memory.mjs` 的实测（node v24 / fflate 0.8.3，三档独立进程）：
 *
 * ```text
 * 8 MiB x 60  → 输入 480 MiB，归档 480 MiB，峰值 1055 MiB RSS  (2.20×)
 * 16 MiB x 30 → 输入 480 MiB，归档 480 MiB，峰值 1025 MiB RSS  (2.13×)
 * 64 MiB x 8  → 输入 512 MiB，归档 512 MiB，峰值 1109 MiB RSS  (2.17×)
 * ```
 *
 * 2.1–2.2× 是 `zipSync` 的固有代价：它要求**全体条目同时在内存**（1×），再产出完整输出归档
 * （1×）。native 写文件时还要再持有一份归档字节，于是总计约 3.2×。按"打包进程 + native 合计
 * 控制在 1 GiB 以内"反推，256 MiB 是 `zipSync` 架构下站得住的上限。
 *
 * 因此本上限**不是产品上限，而是架构上限**。若改为 fflate 的流式 `Zip`（逐块读入、逐块落盘），
 * 峰值降到 O(块大小)，上限即可由产品需要决定而不再受内存约束。改这个常量 **MUST** 重跑实测脚本
 * 并把新数字写进提交说明，不允许凭感觉调整。
 */
export const MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES = 256 * 1024 * 1024;

export const LOCAL_LIBRARY_ARCHIVE_TOO_LARGE_CODE = 'archive-too-large' as const;

/**
 * 归档读取器。按归档内路径取字节。
 *
 * 键是**路径**而不是"卡片/包"这类实体概念：包层因此不需要知道字节来自 SQLite、IndexedDB、
 * 测试夹具还是内存，换来源不需要改这一层。
 */
export type LocalLibraryArchiveReader = (_path: string) => Promise<Uint8Array>;

export interface PackLocalLibraryArchiveOptions {
  /** 覆盖默认上限。**只供测量与测试使用**；生产路径走 `MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES`。 */
  readonly maxTotalBytes?: number;
}

export interface PackedLocalLibraryArchive {
  readonly bytes: Uint8Array;
  /** 实际写入的未压缩字节数。 */
  readonly totalByteLength: number;
  readonly entryCount: number;
}

/**
 * 归一化清单顺序。
 *
 * 排序**必须**在打包器里做，而不能指望调用方先把数组排好——因为排序只作用于 ZIP 条目顺序是
 * 不充分的：`manifest.json` 自身就把数组顺序写进了字节。调用方漏排一次，归档摘要就变了，而症状
 * （摘要漂移）与根因（谁忘了排序）完全无关。
 *
 * 在唯一写字节的地方归一化，这条不变量就无法被忘记。schema 解析已经给出副本，因此排序不会
 * 改动调用方的对象。
 *
 * 排序键用 `path` 而非 id：路径是归档内字节的位置，是"这个归档长什么样"的自然决定因素。
 */
const withCanonicalOrder = (
  manifest: LocalLibraryArchiveManifestV2,
): LocalLibraryArchiveManifestV2 => {
  const byPath = (left: { path: string }, right: { path: string }): number =>
    (left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    ...manifest,
    cards: [...manifest.cards].sort(byPath),
    webPackages: [...manifest.webPackages].sort(byPath),
  };
};

/**
 * 组装一个 portable archive。
 *
 * 清单在**读任何东西之前**先过一遍 schema 并归一化顺序。这不是多余的防御：清单是导出侧构造出来的
 * 对象，而唯一能保证"写出的归档能被自己的导入侧接受、且与输入顺序无关"的地方就是写入点。
 *
 * 上限检查做**两次**，缺一不可：
 *
 * 1. 读之前按清单声明的长度求和并拒绝——这样即使来源谎报，也**不会**先分配到超限才失败；
 * 2. 读之后核对累计——否则一个返回 2 倍字节的来源会让归档悄悄超出上限，而上限正是这里要防的东西。
 *
 * 只做第 2 步，上限就退化成事后观测；只做第 1 步，则对不诚实的来源完全失效。
 */
export const packLocalLibraryArchive = async (
  manifestInput: LocalLibraryArchiveManifestV2,
  read: LocalLibraryArchiveReader,
  options: PackLocalLibraryArchiveOptions = {},
): Promise<PackedLocalLibraryArchive> => {
  const maxTotalBytes = options.maxTotalBytes ?? MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES;
  const manifest = withCanonicalOrder(LocalLibraryArchiveManifestV2Schema.parse(manifestInput));
  assertArchivePathsAgree(manifest);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

  const layout = planArchiveLayout(manifest);
  const declaredTotal = manifestBytes.byteLength
    + layout.reduce((sum, item) => sum + item.declaredByteLength, 0);
  if (declaredTotal > maxTotalBytes) {
    throw new LocalLibraryArchiveTooLargeError(declaredTotal, maxTotalBytes);
  }

  const files: Record<string, Uint8Array | [Uint8Array, { level: number; mtime: Date }]> = {
    [LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH]: manifestBytes,
  };
  let totalByteLength = manifestBytes.byteLength;
  for (const item of layout) {
    const bytes = await read(item.path);
    totalByteLength += bytes.byteLength;
    if (totalByteLength > maxTotalBytes) {
      throw new LocalLibraryArchiveTooLargeError(totalByteLength, maxTotalBytes);
    }
    files[item.path] = item.store ? [bytes, { level: 0, mtime: ZIP_MTIME }] : bytes;
  }

  return {
    bytes: zipSync(files as Zippable, { level: RECORD_DEFLATE_LEVEL, mtime: ZIP_MTIME }),
    totalByteLength,
    entryCount: layout.length + 1,
  };
};

/**
 * 归档字节超限。
 *
 * 独立错误类型而非裸 `RangeError`：UI **MUST** 能把它与"某个条目坏了"区分开，并给出可诊断
 * 提示。`DESK-070` 要求以可诊断错误失败，`MUST NOT` 静默截断。
 *
 * 字段显式声明而**不**用构造函数参数属性（`constructor(readonly x: T)`）：本类必须能被
 * `scripts/measure-archive-memory.mjs` 在 Node 的 `--experimental-strip-types` 下直接加载，而
 * 该模式不支持参数属性。为了让实测工具免于依赖打包器或 tsx，源码这一处刻意保持朴素。
 */
export class LocalLibraryArchiveTooLargeError extends Error {
  readonly code = LOCAL_LIBRARY_ARCHIVE_TOO_LARGE_CODE;
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(actualBytes: number, limitBytes: number) {
    super(`portable archive 超出上限：${actualBytes} > ${limitBytes} 字节`);
    this.name = 'LocalLibraryArchiveTooLargeError';
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

interface ArchiveLayoutItem {
  readonly path: string;
  /** ZIP 内部是否用 store（不压缩）。 */
  readonly store: boolean;
  readonly declaredByteLength: number;
}

/**
 * 条目顺序：卡片记录、Web 包记录、归档字节，各按路径升序。
 *
 * 清单已由 `withCanonicalOrder` 排过一遍，因此这里的排序在正常路径上是幂等的；保留它是因为
 * `planArchiveLayout` 不该依赖调用方的顺序是否已被处理过。
 *
 * 清单**先**写：读者可以先读清单再决定还要读哪些条目，从而不必信任中央目录。
 */
const planArchiveLayout = (manifest: LocalLibraryArchiveManifestV2): ArchiveLayoutItem[] => {
  const byPath = (left: { path: string }, right: { path: string }): number =>
    (left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return [
    ...[...manifest.cards]
      .sort(byPath)
      .map((entry) => ({ path: entry.path, store: false, declaredByteLength: entry.byteLength })),
    ...[...manifest.webPackages]
      .sort(byPath)
      .map((entry) => ({ path: entry.path, store: false, declaredByteLength: entry.byteLength })),
    ...manifest.webPackages
      .map((entry) => ({
        path: entry.archivePath,
        store: true,
        declaredByteLength: entry.archiveByteLength,
      }))
      .sort(byPath),
  ];
};

/**
 * 清单与内容地址的自洽性检查。
 *
 * schema 已经要求 `archivePath` 由 `archiveDigest` 推导，但那是**形状**约束；导出侧是唯一同时
 * 持有"摘要"与"路径"两个概念的代码，在这里再断言一次能把"路径规则改了但某个构造点忘了更新"
 * 变成一次立即失败，而不是一次内容地址错位、且症状与根因完全无关的导入失败。
 */
export const assertArchivePathsAgree = (manifest: LocalLibraryArchiveManifestV2): void => {
  for (const entry of manifest.webPackages) {
    const expected = localLibraryArchiveWebPackageArchivePath(entry.archiveDigest);
    if (entry.archivePath !== expected) {
      throw new Error(`archivePath 与 archiveDigest 不一致：${entry.archivePath} ≠ ${expected}`);
    }
  }
};
