import {
  LOCAL_LIBRARY_ARCHIVE_FORMAT,
  LOCAL_LIBRARY_ARCHIVE_FORMAT_VERSION,
  type LocalLibraryArchiveCardEntryV2,
  type LocalLibraryArchiveManifestV2,
  LocalLibraryArchiveManifestV2Schema,
  type LocalLibraryArchiveWebPackageEntryV2,
  localLibraryArchiveCardPath,
  localLibraryArchiveStem,
  localLibraryArchiveWebPackageArchivePath,
  localLibraryArchiveWebPackagePath,
} from './archive';
import { sha256DigestOfBytes } from './digest';
import {
  LOCAL_CARD_SCHEMA_VERSION,
  type LocalCardRecordV1,
} from './record';
import {
  LOCAL_WEB_PACKAGE_SCHEMA_VERSION,
  type LocalWebPackageRecordV1,
} from './web-package-record';

/**
 * 从本地库"读出清单"，即 portable archive 的导出侧。
 *
 * ## 它解决的问题
 *
 * 清单的每个字段都不是随手填的：`checksum` 是记录 JSON **确切字节**的摘要，`byteLength` 是那
 * 些字节的长度，`archiveDigest` 是 ZIP 字节的摘要，而 `path` 由 id 派生。这五个值必须互相自洽，
 * 而"自洽"不是 schema 能表达的——schema 只能校验形状。
 *
 * 因此构造清单的代码 MUST 是单点。本模块是那个单点：它同时产出 manifest 与
 * {@link createLocalLibraryArchiveReader}，`checksum` 与实际写入的字节由同一个函数产生，
 * 结构上无法错配。此前 `packLocalLibraryArchive` 只接受"已经构造好的 manifest"，于是每个调用方
 * 都要自己算这五个值——两处调用方就已经是两套实现。
 *
 * ## 为什么分页列举由调用方提供
 *
 * 本模块**不**知道库怎么存。Desktop 从 SQLite 分页读，Web 从 IndexedDB 读；两者的分页语义都
 * 不该被这里统一。它只要求一件事，见 {@link LocalLibraryArchiveSource} 的注释。
 */

/** 记录 JSON 的序列化形式。**必须**与本地库存储记录时用的形式一致，见该函数的注释。 */
export const serializeLocalLibraryRecord = (
  record: LocalCardRecordV1 | LocalWebPackageRecordV1,
): string => JSON.stringify(record);

/**
 * 记录 JSON 的 UTF-8 字节。
 *
 * 单独提出这个函数是因为 `checksum` 与 `byteLength` 都必须覆盖**同一份**字节。两侧各自调用
 * `new TextEncoder().encode(JSON.stringify(record))` 时，任何一边改了序列化方式都会让 checksum
 * 与内容错位，而症状是导入侧报"内容损坏"——与根因完全无关。
 */
export const localLibraryRecordBytes = (record: LocalCardRecordV1 | LocalWebPackageRecordV1): Uint8Array =>
  new TextEncoder().encode(serializeLocalLibraryRecord(record));

export interface LocalLibraryArchivePage<T> {
  readonly items: readonly T[];
  /** 续页游标。`undefined` / `null` 表示到底了。 */
  readonly nextCursor?: string | null;
}

/**
 * 导出所需的最小读取面。
 *
 * ## 分页的语义要求
 *
 * 实现 **MUST** 按 `updatedAt` 升序分页，且同一 `updatedAt` 内按 id 升序——即与本地库既有 keyset
 * 排序 `(updated_at, id)` 一致。这条不是性能建议：导出的清单顺序由 id 派生，与分页顺序无关，
 * 但**分页顺序不稳定会让同一次导出把同一张卡读到两次**。重复条目会被 manifest 的唯一性检查
 * 拒绝，报错信息是"archive path must be unique"，而根因是分页不稳定——症状与根因完全无关。
 *
 * 实现 **MUST NOT** 在一次列举过程中把游标之前被更新的行藏起来（否则导出漏记录）。反过来，
 * 列举之后的新行被包含进来或被漏掉都**可以接受**：导出的一致性是"列举时刻的快照"
 * （`DESK-071b`），不是强一致。
 */
export interface LocalLibraryArchiveSource {
  readonly listCards: (
    _cursor?: string,
  ) => Promise<LocalLibraryArchivePage<LocalCardRecordV1>>;
  readonly listWebPackages: (
    _cursor?: string,
  ) => Promise<LocalLibraryArchivePage<LocalWebPackageRecordV1>>;
  /**
   * 按包 id 取 ZIP 字节。
   *
   * 实现 **MUST** 在返回前校验字节摘要与该包记录一致。Desktop 侧 `BlobStore::read` 已做此校验；
   * 这里再次校验是**独立**的第二道，因为归档的 `archiveDigest` 由本模块计算：native 漏校验时
   * 症状会是"导出的归档导入后校验失败"，而那时文件已经离开了用户能触达的范围。
   */
  readonly readWebPackageArchive: (_packageId: string) => Promise<Uint8Array>;
}

export interface BuildLocalLibraryArchiveManifestOptions {
  /**
   * 覆盖清单里的 `exportedAt`（ISO 8601 带偏移）。
   *
   * **只供测试与测量使用**：它是 manifest 的必填字段，因此必然进入归档字节（`DESK-070`
   * "归档的确定性边界"）。生产路径 MUST 让它取真实导出时间。
   */
  readonly exportedAt?: string;
}

/**
 * 归档条目的一个条目与它写入的字节。
 *
 * `checksum` 与 `byteLength` 在这里与字节**同时**产生，而不是事后再算：manifest 是给读者看的
 * 声明，而读者验证的是文件里的字节。
 */
interface EntryDraft<T> {
  readonly entry: T;
  readonly bytes: Uint8Array;
}

export interface CollectedLocalLibraryArchive {
  readonly manifest: LocalLibraryArchiveManifestV2;
  /** 归档字节读取器，直接交给 {@link packLocalLibraryArchive}。 */
  readonly read: (_path: string) => Promise<Uint8Array>;
}

/**
 * 构造导出所需的清单与读取器。
 *
 * 两者**必须**成对返回：清单声明 `checksum` 与 `byteLength`，读取器写出那些字节，分开构造就是
 * 允许"清单和字节各说各话"的结构。返回对象里只保留**记录**（每个几百字节），ZIP 字节按需读——
 * 缓存它们会把峰值从 1× 抬到 2×，而 `DESK-070` 的 256 MiB 正是按 `zipSync` 的 1× 峰值反推的。
 */
/**
 * 构造导出所需的清单与读取器。
 *
 * 两者**必须**成对返回：清单声明 `checksum` 与 `byteLength`，读取器写出那些字节，分开构造就是
 * 允许"清单和字节各说各话"的结构。返回对象里只保留**记录**（每个几百字节），ZIP 字节按需读——
 * 缓存它们会把峰值从 1× 抬到 2×，而 `DESK-070` 的 256 MiB 正是按 `zipSync` 的 1× 峰值反推的。
 *
 * 内部顺序：**先**列举全部记录，**再**为每个 Web 包读一次 ZIP 算 `archiveDigest`。流式交错
 * （读一个算一个）看似更省，实则会让一次失败把已经读过的几百 MiB 全部丢掉；而且清单构造只需要
 * 每个包几十字节的记录，先构造完再读 ZIP 也让"哪些包要读"一目了然。
 *
 * ZIP 字节因此被读两次（一次算摘要、一次打包）。这是 `zipSync` 架构的固有代价而非本模块的浪费：
 * 打包器要求全体条目同时在内存，所以"留住 ZIP 字节"并不比打包时更省。
 */
export const collectLocalLibraryArchive = async (
  source: LocalLibraryArchiveSource,
  options: BuildLocalLibraryArchiveManifestOptions = {},
): Promise<CollectedLocalLibraryArchive> => {
  const exportedAt = options.exportedAt ?? new Date().toISOString();

  const cardRecords = await drain(source.listCards);
  const webPackageRecords = await drain(source.listWebPackages);

  const cards: Array<EntryDraft<LocalLibraryArchiveCardEntryV2>> = cardRecords.map((record) => {
    const bytes = localLibraryRecordBytes(record);
    return {
      bytes,
      entry: {
        cardId: record.id,
        path: localLibraryArchiveCardPath(localLibraryArchiveStem(record.id)),
        contentDigest: record.contentDigest,
        checksum: PLACEHOLDER_CHECKSUM,
        byteLength: bytes.byteLength,
      },
    };
  });

  const webPackages: Array<EntryDraft<LocalLibraryArchiveWebPackageEntryV2>> = [];
  for (const record of webPackageRecords) {
    const archiveBytes = await source.readWebPackageArchive(record.id);
    const archiveDigest = await sha256DigestOfBytes(archiveBytes);
    if (archiveBytes.byteLength !== record.archiveByteLength) {
      // 记录声称的 ZIP 长度与实际字节不符。清单会写哪个？两个都不可信，因此在这里失败——
      // 选一个"看起来对"的值会让 `archive-too-large` 预算或导入侧长度校验报出与根因无关的错误。
      throw new Error(
        `Web 包 ${record.id} 的 archiveByteLength 与实际字节不符：${record.archiveByteLength} ≠ ${archiveBytes.byteLength}`,
      );
    }
    const bytes = localLibraryRecordBytes(record);
    webPackages.push({
      bytes,
      entry: {
        packageId: record.id,
        path: localLibraryArchiveWebPackagePath(localLibraryArchiveStem(record.id)),
        contentDigest: record.contentDigest,
        checksum: PLACEHOLDER_CHECKSUM,
        byteLength: bytes.byteLength,
        archivePath: localLibraryArchiveWebPackageArchivePath(archiveDigest),
        archiveDigest,
        archiveByteLength: archiveBytes.byteLength,
      },
    });
  }

  // `checksum` 在这里才被填上，因为摘要计算是异步的，而先填后改会让"清单是导出的唯一真相"
  // 在类型上不再成立。占位符必须通过 schema 的形状校验，因此给一个形状正确的假值。
  const manifest = LocalLibraryArchiveManifestV2Schema.parse({
    format: LOCAL_LIBRARY_ARCHIVE_FORMAT,
    formatVersion: LOCAL_LIBRARY_ARCHIVE_FORMAT_VERSION,
    cardSchemaVersion: LOCAL_CARD_SCHEMA_VERSION,
    webPackageSchemaVersion: LOCAL_WEB_PACKAGE_SCHEMA_VERSION,
    exportedAt,
    cardCount: cards.length,
    webPackageCount: webPackages.length,
    cards: await withChecksums(cards),
    webPackages: await withChecksums(webPackages),
  });

  const recordBytesByPath = new Map<string, Uint8Array>();
  for (const draft of [...cards, ...webPackages]) recordBytesByPath.set(draft.entry.path, draft.bytes);
  const archiveOwnerByPath = new Map<string, string>();
  for (const draft of webPackages) archiveOwnerByPath.set(draft.entry.archivePath, draft.entry.packageId);

  return {
    manifest,
    read: async (path: string): Promise<Uint8Array> => {
      const record = recordBytesByPath.get(path);
      if (record !== undefined) return record;
      const owner = archiveOwnerByPath.get(path);
      if (owner !== undefined) return source.readWebPackageArchive(owner);
      throw new Error(`归档条目路径在清单中不存在：${path}`);
    },
  };
};

/**
 * 占位的 `checksum`。
 *
 * 它必须通过 schema 的形状校验，而真正的值只能在字节就绪后异步算出。留一个看起来合法的假摘要
 * 比放宽类型更安全：若某条路径忘了填真值，清单会带着一个全零摘要通过 schema，而
 * `assertArchivePathsAgree` 与导入侧校验任一处都会立刻抓到它。
 */
const PLACEHOLDER_CHECKSUM = 'sha256:' + '0'.repeat(64);

/** 把每个条目的 `checksum` 换成它自己那一份字节的摘要。 */
const withChecksums = async <T extends { checksum: string }>(
  drafts: ReadonlyArray<EntryDraft<T>>,
): Promise<T[]> =>
  Promise.all(
    drafts.map(async ({ entry, bytes }) => ({ ...entry, checksum: await sha256DigestOfBytes(bytes) })),
  );

/**
 * 拉完一个游标分页源。
 *
 * 没有页数上限，而有**不重复**的硬要求：见 {@link LocalLibraryArchiveSource} 里关于分页顺序的
 * 说明。加上限会让一个实现错误的来源（每页都返回第一页）变成"导出少了 N 条"这种沉默的截断，
 * 而 manifest 自身无法发现——它只看到一份自洽的清单。
 */
const drain = async <T>(
  list: (_cursor?: string) => Promise<LocalLibraryArchivePage<T>>,
): Promise<T[]> => {
  const all: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await list(cursor);
    all.push(...page.items);
    const next = page.nextCursor;
    if (next === undefined || next === null) return all;
    // 来源若返回已见过的游标，说明分页不前进。`continue` 会变成死循环，因此直接失败。
    if (seenCursors.has(next)) {
      throw new Error(`本地库分页未前进（游标重复：${next}）`);
    }
    seenCursors.add(next);
    cursor = next;
  }
};
