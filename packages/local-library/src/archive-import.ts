import { Unzip, UnzipInflate } from 'fflate';

import {
  LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH,
  type LocalLibraryArchiveCardEntryV2,
  type LocalLibraryArchiveManifestV2,
  LocalLibraryArchiveManifestV2Schema,
  MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES,
  type LocalLibraryArchiveWebPackageEntryV2,
  parseLocalLibraryArchiveCard,
  parseLocalLibraryArchiveWebPackage,
} from './archive';
import { MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES } from './archive-pack';
import { unpackWebPackageZip } from '@mahoshojo/web-package';

import { sha256DigestOfBytes } from './digest';
import type { CardRepository } from './repository';
import type { WebPackageRepository } from './web-package-record';

/**
 * 导入不可信归档：bounded streaming import（`DESK-074`）。
 *
 * ## 为什么这段代码长这样
 *
 * 导出侧的自洽性由内容寻址保证，而导入面对的是**别人给的字节**——攻击者可以伪造清单里的任何字段。
 * 因此这里每一个决定都服务于同一件事：**在任何一次写本地库之前，先把这份归档证明为可接受的**。
 *
 * - **manifest 优先**：`manifest.json` 必须是**第一个** entry，且在一个独立的、远小于归档总预算的
 *   上限内读完。只有先拿到清单，才能在解压其余条目**之前**算出期望路径集与声明总字节。
 *   OWASP ASVS 5.0 V5.2.3 要求在解压前检查最大未压缩尺寸与最大文件数；"先 `unzipSync` 全量解压、
 *   再校验 manifest"恰好违反这条，因此 manifest 优先是**格式属性**，不是性能优化。
 * - **流式 + 逐条预算**：`fflate` 的流式 `Unzip` 按 local header 顺序产出条目，因此能在条目边界
 *   上做检查。累计字节按**实际输出**计数，**MUST NOT** 采信中央目录里的 `originalSize`——那是
 *   攻击者可控的声明值。
 * - **两趟**：preflight 一趟只校验，apply 一趟才写入。代价是解压两次，换来"全部 preflight 在第一次
 *   mutation 之前完成"与 bounded 内存可以同时成立——一次全量 `unzipSync` 会把所有条目同时放进内存。
 * - **existing wins**：本地已存在的记录一律保留、跳过并逐条列出。这不是省事：在已有
 *   `nextLocalTimestamp` 单调时间戳与 tombstone 语义的模型里，"时间新的赢"或"强制覆盖"都需要额外
 *   定义，而猜错的后果是静默丢失用户刚刚做的删除（`DESK-074`"冲突策略"）。
 *
 * ## 内存的准确边界
 *
 * 峰值是**一个条目**加上"已经解出但写入方还没消费的那些条目"，不是整个归档：
 *
 * - 每条目的字节在自己的 `ondata` 回调里累积，条目结束即被消费；
 * - 实际长度超过清单声明长度（或 manifest 上限）时**立即**中止，因此缓冲区不会超过
 *   "声明长度 + 一个输入块"；
 * - apply 在两个输入块之间 `await` 写入队列清空，因此在途条目不超过一个块的内容。
 *
 * 这仍然不是 O(1)：单个 Web 包 ZIP 可能有几十 MiB。要真正做到 O(块大小)需要增量摘要算子
 * （`crypto.subtle.digest` 不支持流式），那是独立的取舍，不在 V1 里。
 */

/** 导入的最小写入面。只用两个既有端口，**不新增** native command（`DESK-071b`）。 */
export interface LocalLibraryArchiveImportTarget {
  readonly cards: CardRepository;
  readonly packages: WebPackageRepository;
}

/**
 * `manifest.json` 的独立字节上限。
 *
 * **远小于**归档总预算（256 MiB），取 16 MiB。它必须是"即使归档其余部分全是垃圾，清单本身也只能
 * 占这么点"的硬上限，同时又要容得下真实库的清单——一个卡片条目约 230 字节、一个 Web 包条目约
 * 350 字节，因此 16 MiB 覆盖约 5 万条，而真实的个人库在 thousands 量级。
 *
 * 它与归档总预算是**两个**上限：合成一个会让"清单巨大"与"载荷巨大"变成同一种失败，而两者的
 * 攻击面与用户动作不同。
 */
export const MAX_LOCAL_LIBRARY_ARCHIVE_MANIFEST_BYTES = 16 * 1024 * 1024;

/**
 * 推给流式解包器的输入块大小。
 *
 * ## 这个数字被一条与 fflate 实现的耦合决定，不是性能调参
 *
 * `Unzip.push` 在**一次调用内**按条目数递归：每发现一个 local header 就 `return this.push(rest)`
 * 一次（`fflate/esm/index.mjs` 的 `if (f & 2) return this.push(buf.subarray(i), final)`，以及
 * `if (chunk.length) return this.push(chunk, final)`），即每个条目约 2 层。因此一次 push 里的
 * 条目数直接就是调用栈深度，而条目密度由**攻击者**决定。
 *
 * 实测（10 万个恶意条目、每个约 108 字节）：4 MiB 块 → 深度 2829 → `RangeError`。而这不是纯粹的
 * 攻击面——`packLocalLibraryArchive` **没有条目数上限**，`MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES` 是
 * 100_000，因此本仓库自己的导出器能产出一个本模块读不回来的归档：约 2300 张卡就会炸。
 *
 * 32 KiB 块在同一探测下深度 1427（安全），因此本值取 32 KiB。改它 **MUST** 重跑
 * `archive-import.test.ts` 里那条"数千条目仍可导入"的门禁——那条门禁存在的唯一理由就是钉住这里。
 *
 * 代价是 256 MiB 归档要 push 8192 次。每次 push 只扫一遍自己那块字节，总扫描量仍是 O(n)。
 *
 * `RangeError` 另有一层兜底：栈溢出不是可诊断的失败形态，因此 push 循环把任何非本模块的异常
 * （含 `RangeError`）归成 `archive-malformed`。兜底保证的是**失败得可诊断**，不是"够用"。
 */
const STREAM_CHUNK_BYTES = 32 * 1024;

/**
 * 归档内允许出现的路径命名空间。清单不在这里——它是第一个 entry，单独判定。
 *
 * 它是一条**诊断**守卫而不是唯一防线：任何通过它的路径随后还必须在清单的期望路径集里，而清单
 * schema 已经把声明路径限制在这三个命名空间内。留它是为了让"这个条目根本不属于归档布局"与
 * "这个条目不在清单里"给出不同的错误码——两者的排障方向不同。
 */
const ALLOWED_NAMESPACES = ['cards/', 'web-packages/', 'archives/'] as const;

/**
 * 导入被拒的原因。
 *
 * 分开而不是合成一个"归档有问题"：UI 需要分别告诉用户"这不是我们的归档""这个归档自己前后不一致"
 * "这个归档太大"。三者的用户动作完全不同，而症状统一之后就没有任何可诊断信息了。
 */
export const LOCAL_LIBRARY_ARCHIVE_IMPORT_ERROR_CODES = [
  /** 不是可读的 ZIP：结构损坏、未知压缩方法、条目头不可解析。 */
  'archive-malformed',
  /** manifest 缺失、不是第一个 entry、超过 manifest 上限，或不通过契约校验。 */
  'archive-manifest-invalid',
  /** 路径不在 allowlist、路径重复、清单未声明、清单声明但归档里缺失、记录与清单不符。 */
  'archive-entry-invalid',
  /** 实际长度或实际摘要与清单声明不符。 */
  'archive-entry-corrupt',
  /** 条目数超过 `MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES`。 */
  'archive-too-many-entries',
  /** 累计实际解压字节超过归档总预算。 */
  'archive-budget-exceeded',
  /** 条目字节不是一条通过记录契约校验的记录 JSON。 */
  'archive-record-invalid',
  /**
   * 内层 Web 包 ZIP 不是记录所声明的那个包。
   *
   * 独立于 `archive-entry-corrupt`：那条说的是"这段字节与清单声明不符"（传输或截断问题，重试同一个
   * 文件可能仍然失败但值得再试），这一条说的是"**记录与 ZIP 各说各话**"——归档是**有意**这样构造的，
   * 因为每一段字节都与清单的声明自洽。因此 UI MUST NOT 把它显示成"文件损坏，请重试"。
   */
  'archive-package-mismatch',
] as const;

export type LocalLibraryArchiveImportErrorCode =
  (typeof LOCAL_LIBRARY_ARCHIVE_IMPORT_ERROR_CODES)[number];

/**
 * 导入被拒。
 *
 * 独立错误类型而非裸 `Error`：UI **MUST** 能把它与"本地库写入失败"区分开——前者是这份文件的问题，
 * 重试同一个文件毫无意义；后者重试有意义。
 */
export class LocalLibraryArchiveImportError extends Error {
  readonly code: LocalLibraryArchiveImportErrorCode;

  constructor(code: LocalLibraryArchiveImportErrorCode, message: string) {
    super(message);
    this.name = 'LocalLibraryArchiveImportError';
    this.code = code;
  }
}

const fail = (
  code: LocalLibraryArchiveImportErrorCode,
  message: string,
): LocalLibraryArchiveImportError => new LocalLibraryArchiveImportError(code, message);

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * 写���入失败的**用户可见**原因。
 *
 * 与 {@link describe} 的区别：`ZodError.message` 是整个 issues 数组的 JSON，几百字符、直接进报告，
 * 而 UI 要展示的是一句"这条记录没写进去"。因此这里先把契约层已归类过的错误原样透出，其余压成
 * 一句通用说明并保留原始消息的前若干字符用于本地排障。
 */
const describeWriteFailure = (cause: unknown): string => {
  if (cause instanceof LocalLibraryArchiveImportError) return cause.message;
  const detail = describe(cause);
  return detail.length > 200 ? `写入失败：${detail.slice(0, 200)}…` : `写入失败：${detail}`;
};

/**
 * existing-wins 探测用的分页大小。
 *
 * 与两个端口各自的 `MAX_*_PAGE_SIZE` 上限一致取 100：`list` 的 limit 有契约上限，给一个更大的值
 * 会在真实 adapter 上被 schema 拒掉，而这个错误与"归档有问题"无关。
 */
const EXISTENCE_PAGE_SIZE = 100;

/**
 * 拉完一个 keyset 分页源，把其中的 id 收成集合。
 *
 * 没有页数上限，而有**不重复**的硬要求：游标重复说明分页不前进，`continue` 会变成死循环，
 * 因此直接失败。这与导出侧 `drain` 的处理一致——一个实现错误的来源（每页都返回第一页）在这里
 * 会变成"已有记录被算成没有"，那会让 existing-wins 失效并**覆盖**本地记录，因此必须失败而不是
 * 截断。
 */
const collectExistingIds = async <T>(
  list: (_cursor?: string) => Promise<{ items: readonly T[]; nextCursor?: string | null }>,
  idOf: (_item: T) => string,
): Promise<string[]> => {
  const ids: string[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await list(cursor);
    for (const item of page.items) ids.push(idOf(item));
    const next = page.nextCursor;
    if (next === undefined || next === null) return ids;
    if (seenCursors.has(next)) {
      throw new Error(`本地库分页未前进（游标重复：${next}）`);
    }
    seenCursors.add(next);
    cursor = next;
  }
};

/** 导入摘要。UI 在**写入之前**展示它（`DESK-052`：导入 MUST 先展示摘要、版本、条目数与冲突策略）。 */
export interface LocalLibraryArchiveImportSummary {
  readonly format: string;
  readonly formatVersion: number;
  readonly exportedAt: string;
  readonly cardCount: number;
  readonly webPackageCount: number;
  readonly cardSchemaVersion: number;
  readonly webPackageSchemaVersion: number;
}

/**
 * 一次 preflight 的产物。
 *
 * 它是"这份归档可接受、且这些条目本地已经有了"的**唯一**事实来源：`apply` 不再重新判断冲突，
 * 因此"展示给用户的摘要"与"实际写入的结果"不可能各说各话。
 */
export interface LocalLibraryArchiveImportPlan {
  readonly summary: LocalLibraryArchiveImportSummary;
  readonly manifest: LocalLibraryArchiveManifestV2;
  /** `manifest.json` 那段字节的摘要。apply 用它确认两趟读到的是同一份清单。 */
  readonly manifestDigest: string;
  /** 本地已存在的卡片 id：apply 会跳过并逐条列出（existing wins）。 */
  readonly existingCardIds: readonly string[];
  /** 本地已存在的 Web 包 id。 */
  readonly existingWebPackageIds: readonly string[];
}

/** 被跳过的一条：本地已有。`DESK-074` 的 existing wins。 */
export interface LocalLibraryArchiveImportSkip {
  readonly kind: 'card' | 'web-package';
  readonly id: string;
  readonly reason: 'already-present';
}

/** 写入失败的一条。apply **不**因单条失败而中止，也**不**做整体回滚。 */
export interface LocalLibraryArchiveImportFailure {
  readonly kind: 'card' | 'web-package';
  readonly id: string;
  readonly reason: string;
}

export interface LocalLibraryArchiveImportReport {
  readonly succeededCardIds: readonly string[];
  readonly succeededWebPackageIds: readonly string[];
  readonly skipped: readonly LocalLibraryArchiveImportSkip[];
  readonly failed: readonly LocalLibraryArchiveImportFailure[];
}

export interface LocalLibraryArchiveImportBudgets {
  /** 覆盖归档总预算。**只供测试使用**；生产路径走输出上限。 */
  readonly maxTotalBytes?: number;
  /** 覆盖 manifest 上限。**只供测试使用**。 */
  readonly maxManifestBytes?: number;
  /** 覆盖条目数上限。**只供测试使用**。 */
  readonly maxEntries?: number;
}

interface ResolvedBudgets {
  readonly maxTotalBytes: number;
  readonly maxManifestBytes: number;
  readonly maxEntries: number;
}

const resolveBudgets = (budgets: LocalLibraryArchiveImportBudgets): ResolvedBudgets => ({
  maxTotalBytes: budgets.maxTotalBytes ?? MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES,
  maxManifestBytes: budgets.maxManifestBytes ?? MAX_LOCAL_LIBRARY_ARCHIVE_MANIFEST_BYTES,
  maxEntries: budgets.maxEntries ?? MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES,
});

/**
 * 一条已按清单声明校验、且实际长度已核对的条目。
 *
 * 摘要尚未核对：解包器是同步的而 `crypto.subtle.digest` 是异步的，因此摘要在条目结束之后由
 * {@link scanArchive} 统一 `await`。
 */
interface ScannedEntry {
  readonly path: string;
  readonly declaredByteLength: number;
  readonly declaredDigest: string;
  readonly bytes: Uint8Array;
}

interface ScanResult {
  readonly manifest: LocalLibraryArchiveManifestV2;
  readonly manifestBytes: Uint8Array;
}

/**
 * 同步扫描一遍归档。
 *
 * 同步能做完的是**形状与预算**：条目数、路径 allowlist、路径唯一性、清单声明集合、每条目的实际
 * 长度、以及累计实际输出字节。它们全部是内存安全控制，因此 MUST 在分配之前完成。
 *
 * 每条路径的**处理方式**交给 `onEntry`：preflight 丢弃字节只做校验，apply 保留字节去写。
 *
 * `onEntry` 的第一个参数是已解析的清单：清单是第一个 entry，因此非 manifest 条目到达时它必然
 * 已经就绪——这正是"manifest 优先让期望集合可以在解压其余条目**之前**算出来"的具体形态。
 */
const scanArchiveAsync = async (
  archive: Uint8Array,
  budgets: ResolvedBudgets,
  onEntry: (_manifest: LocalLibraryArchiveManifestV2, _entry: ScannedEntry) => void,
  stopAfterManifest = false,
  // 每推完一块就被 await 一次。它是**唯一**能让同步的解包流程与异步的下游真正交错的接缝。
  afterChunk: () => Promise<void> = async () => undefined,
): Promise<ScanResult> => {
  const declaredByPath = new Map<string, { byteLength: number; digest: string }>();
  const seenPaths = new Set<string>();

  let manifest: LocalLibraryArchiveManifestV2 | null = null;
  let manifestBytes: Uint8Array = new Uint8Array();

  let entryCount = 0;
  /**
   * 两个计数器，**MUST NOT** 合成一个。
   *
   * - `declaredTotalBytes` 是清单声明之��的累计，在条目开始解压**之前**收口：这是 OWASP ASVS
   *   V5.2.3 要求的"解压前检查"。
   * - `actualTotalBytes` 是**实际输出**的累计，DESK-074 要求它按实际输出计数而不是采信中央目录里
   *   攻击者可控的 `originalSize`。
   *
   * 合成一个会让同一段字节被收两次费：对一份自洽归档，实际总量等于声明总量，于是计数器最终停在
   * ≈2× 载荷，而预算比的是 1×。后果不是保守而是** importer 拒绝导出器自己的产物**——实测
   * 200 MiB 的库导出成功、导入被拒，而错误信息写的是"归档声明总字节超过预算：272 MiB > 256 MiB"，
   * 那个 272 MiB 里有一半是重复计费。
   */
  let declaredTotalBytes = 0;
  let actualTotalBytes = 0;

  /** 当前条目的累积缓冲；条目结束即清空，因此峰值是**一个**条目。 */
  let buffer: Uint8Array = new Uint8Array(0);
  let buffered = 0;
  /**
   * 当前条目声明的长度与摘要；`null` 表示当前条目是 manifest。
   *
   * 它放在 handler 之外是因为 `finishEntry` 会在 `ondata` 回调里跑，那时 handler 的局部变量
   * 已经不可见。
   */
  let entryDeclared: { byteLength: number; digest: string } | null = null;
  /** 当前条目实际长度允许多出的量：manifest 是它自己的上限，其余是清单声明的长度。 */
  let slack = 0;
  /**
   * 按 `slack` 几何增长，而不是每来一块就重新分配并拷贝全部。
   *
   * 逐块 `new Uint8Array(buffered + n)` 是 O(n²) 的拷贝：一个 128 MiB 的条目在最坏交付粒度下要
   * 拷走约 2 GiB。缓冲区**永不**超过 `slack`（上面那道守卫先判），因此容量增长的终点是已知的。
   */
  const reserveCapacity = (required: number): Uint8Array => {
    const capacity = Math.min(slack, Math.max(1024, buffer.byteLength * 2, required));
    const grown = new Uint8Array(capacity);
    grown.set(buffer, 0);
    buffer = grown;
    return grown;
  };
  /** 当前条目的路径。`finishEntry` 在 `ondata` 回调里用它，而那时 handler 的局部变量已不可见。 */
  let currentName = '';

  /**
   * `finishEntry` 在 `ondata` 收到 `final` 时触发，而不是在 `start()` 之后立刻触发——fflate 的
   * `start()` 只喂已经缓冲到的压缩字节，条目剩余部分要到后续 `push` 才到达。提前结束会把一个
   * 空 buffer 当成条目内容，而症状是"manifest.json 不是合法 JSON"，与真正的原因隔了整个 ZIP 格式。
   */
  let entryIsManifest = false;
  let entryFinished = false;

  const finishEntry = (): void => {
    if (entryFinished) return;
    entryFinished = true;
    const isManifest = entryIsManifest;
    const expected = entryDeclared;
    const length = buffered;
    // **必须按长度切一份**：缓冲区现在按几何增长的容量分配，直接交出去会把尾部未使用的容量
    // （以及它的零字节）当成条目内容——症状是"manifest.json 不是合法 JSON"，与真正的原因
    // 隔了一个 ZIP 格式。切而不是视图，是为了让下游不留住整块容量。
    const bytes = buffer.slice(0, length);
    entryIsManifest = false;
    entryDeclared = null;
    buffer = new Uint8Array(0);
    buffered = 0;

    if (isManifest) {
      manifestBytes = bytes;
      manifest = parseArchiveManifest(bytes);
      for (const entry of manifest.cards) {
        declaredByPath.set(entry.path, { byteLength: entry.byteLength, digest: entry.checksum });
      }
      for (const entry of manifest.webPackages) {
        declaredByPath.set(entry.path, { byteLength: entry.byteLength, digest: entry.checksum });
        declaredByPath.set(entry.archivePath, {
          byteLength: entry.archiveByteLength,
          digest: entry.archiveDigest,
        });
      }
      return;
    }
    if (length !== expected?.byteLength) {
      throw fail(
        'archive-entry-corrupt',
        `归档条目长度与清单声明不符：声明 ${expected?.byteLength}，实际 ${length}`,
      );
    }
    // 走到这里说明 manifest 条目已经结束并解析过，因此 `manifest` 必然非空。
    onEntry(manifest as LocalLibraryArchiveManifestV2, {
      path: currentName,
      declaredByteLength: length,
      declaredDigest: expected?.digest ?? '',
      bytes,
    });
  };

  const unzip = new Unzip((file) => {
    entryCount += 1;
    if (entryCount > budgets.maxEntries) {
      throw fail('archive-too-many-entries', `归档条目数超过上限 ${budgets.maxEntries}`);
    }
    if (seenPaths.has(file.name)) {
      // 重复路径会让解包时后者静默覆盖前者，而中央目录里只看得到最后一份。
      throw fail('archive-entry-invalid', `归档内出现重复路径：${file.name}`);
    }
    seenPaths.add(file.name);

    currentName = file.name;
    entryFinished = false;
    entryIsManifest = entryCount === 1;
    if (entryIsManifest) {
      if (file.name !== LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH) {
        throw fail(
          'archive-manifest-invalid',
          `${LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH} 必须是归档的第一个条目，实际是 ${file.name}`,
        );
      }
      slack = budgets.maxManifestBytes;
    } else {
      if (!ALLOWED_NAMESPACES.some((namespace) => file.name.startsWith(namespace))) {
        throw fail('archive-entry-invalid', `归档条目路径不在 allowlist 内：${file.name}`);
      }
      // 清单是第一个 entry，因此到这里期望集合必然已就绪。
      const expected = declaredByPath.get(file.name);
      if (expected === undefined) {
        throw fail('archive-entry-invalid', `归档含有清单未声明的条目：${file.name}`);
      }
      entryDeclared = expected;
      // 声明长度先计入预算：这是"在任何分配发生前拒绝超限输入"的那一半。
      declaredTotalBytes += expected.byteLength;
      if (declaredTotalBytes > budgets.maxTotalBytes) {
        throw fail(
          'archive-budget-exceeded',
          `归档声明总字节超过预算：${declaredTotalBytes} > ${budgets.maxTotalBytes}`,
        );
      }
      // `slack` 就是**清单声明的长度**，而不是"声明长度 + 一个块"。多留一个块会让越界
      // 直到条目结束才被发现，那时缓冲区已经长到攻击者指定的尺寸——那正是本条守卫要阻止的。
      // 恰好等于声明长度的条目永远触发不到它：`buffered` 只增不减，最后一块让它正好相等。
      slack = expected.byteLength;
    }
    buffer = new Uint8Array(0);
    buffered = 0;

    file.ondata = (error, data, final) => {
      if (error !== null) {
        // 解包器会把下游抛出的错误原样回灌到 `error` 参数上。重新包一层会把"声明长度超限"
        // 之类的精确诊断压成"归档损坏"，而那正是 UI 需要区分的两类失败。
        throw error instanceof LocalLibraryArchiveImportError
          ? error
          : fail('archive-malformed', `归档条目无法解压：${error.message}`);
      }
      if (data.byteLength > 0) {
        actualTotalBytes += data.byteLength;
        // 预算守卫与单条目长度守卫的**先后顺序是有意义的**，因此它排在前面：当攻击者给一个条目
        // 谎报一个巨大长度时，预算先响，报的是"这个归档太大"；而谎报一个小长度时预算不会响，
        // 随后由单条目守卫报"这条比清单声称的长"。两种情况都带走了解压预算，只是一条归档级的
        // 诊断，一条条目级的。
        if (actualTotalBytes > budgets.maxTotalBytes) {
          throw fail(
            'archive-budget-exceeded',
            `归档实际解压字节超过预算：${actualTotalBytes} > ${budgets.maxTotalBytes}`,
          );
        }
        if (buffered + data.byteLength > slack) {
          // 实际长度超过声明长度（或 manifest 上限）时**立即**中止，而不是收完再判：继续累积只会让
          // 缓冲区长到攻击者指定的那个尺寸，而那正是本条检查要阻止的事。
          throw fail(
            entryIsManifest ? 'archive-manifest-invalid' : 'archive-entry-corrupt',
            entryIsManifest
              ? `${LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH} 超过上限 ${budgets.maxManifestBytes} 字节`
              : `归档条目实际长度超过清单声明的 ${entryDeclared?.byteLength}`,
          );
        }
        if (buffered + data.byteLength > buffer.byteLength) reserveCapacity(buffered + data.byteLength);
        buffer.set(data, buffered);
        buffered += data.byteLength;
      }
      if (final) finishEntry();
    };

    file.start();
    // 刻意**不**在这里兜底 `finishEntry()`：fflate 在 `start()` 里只喂已经缓冲到的压缩字节，
    // 条目的剩余部分要到后续 `push` 才到达。提前结束会把一个空 buffer 当成条目内容——
    // 症状是"manifest.json 不是合法 JSON"，与真正的原因隔了整个 ZIP 格式。
  });
  unzip.register(UnzipInflate);

  try {
    for (let offset = 0; offset < archive.byteLength; offset += STREAM_CHUNK_BYTES) {
      if (stopAfterManifest && manifest !== null) break;
      const end = Math.min(offset + STREAM_CHUNK_BYTES, archive.byteLength);
      unzip.push(archive.subarray(offset, end), end >= archive.byteLength);
      // 在这里让出，而不是在条目结束时：条目回调是同步栈上的一环，在那里 `await` 只会挂一个
      // 续体而不会真的挂起扫描，于是"同时只留一个条目"就只是注释。
      await afterChunk();
    }
  } catch (cause) {
    // `ondata` 里的异常已经被原样回灌（解包器把下游抛出的错误当作 `error` 参数送回），因此这里
    // 收到的是两类东西：解包器自己抛的（`err(13)` unexpected EOF、`err(4)`、`RangeError` 栈溢出），
    // 以及我们自己抛的。后者带 code，**MUST** 保留——把"声明长度超限"压成"归档损坏"会让 UI 丢掉
    // 最接近根因的那条诊断。前者没有 code，因此在这里归成 archive-malformed。
    throw cause instanceof LocalLibraryArchiveImportError
      ? cause
      : fail('archive-malformed', `归档无法解压：${describe(cause)}`);
  }

  if (stopAfterManifest) {
    // `manifest === null` 在这里不可达：条目 1 必须是 manifest.json，而它的 `finishEntry` 一定会
    // 解析它或抛错。保留这条断言是因为它是"只读清单"这条短路径**唯一**的失败出口。
    if (manifest === null) {
      throw fail('archive-manifest-invalid', `归档缺少 ${LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH}`);
    }
    return { manifest, manifestBytes };
  }

  if (entryCount === 0) {
    // 一个条目都发现不了，意味着这根本不是 ZIP。说成"缺少 manifest.json"会让用户去检查一个
    // 他们选错文件的问题，而正确诊断是"这不是一个归档"。
    throw fail('archive-malformed', '归档里没有任何条目，它可能不是 ZIP 文件');
  }
  // 同上：`entryCount >= 1` 且条目 1 必须是 manifest.json，因此 `manifest` 必然已解析。
  if (manifest === null) {
    throw fail('archive-manifest-invalid', `归档缺少 ${LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH}`);
  }
  // 清单声明了但归档里没有的条目：必须在写入之前发现，否则导入会"成功"却少东西。
  for (const path of declaredByPath.keys()) {
    if (!seenPaths.has(path)) {
      throw fail('archive-entry-invalid', `归档缺少清单声明的条目：${path}`);
    }
  }
  return { manifest, manifestBytes };
};

/**
 * 扫描 + 摘要核对 + 每条目的额外异步证明。
 *
 * ## 摘要为什么必须挂在这条接缝上
 *
 * 摘要不能在同一趟里同步完成（解包器同步、摘要算子异步）。把每条目的字节交给 `crypto.subtle`
 * 之后**立刻丢掉引用**是不够的：`sha256DigestOfBytes` 在调用时就把 buffer 复制走（WebCrypto 的
 * 算法接收副本），而复制品要等 promise 被 await 才被回收。因此若整趟扫描结束才统一 await，
 * **所有条目的摘要副本会同时存活**——实测一个 64 MiB 条目的归档额外占用 128 MiB。
 *
 * 修法是让摘要串成一条链，并在**每个输入块之后** await 一次它。32 KiB 的块意味着一次块内最多
 * 完成一个条目，于是同时存活的字节缓冲是 2 个条目（正在解出的那个 + 刚交完摘要的那个），
 * 与归档总条目数无关。
 *
 * `crypto.subtle` 在调用时复制 buffer 这条依赖写在这里，是因为它一旦被破坏，症状是"偶发的摘要
 * 把关失败"——极难定位。
 */
const scanArchive = async (
  archive: Uint8Array,
  budgets: ResolvedBudgets,
  onEntry: (_manifest: LocalLibraryArchiveManifestV2, _entry: ScannedEntry) => void,
  options: {
    readonly expectedManifestDigest?: string;
    /** 块之间额外被 await 的东西。apply 用它把写入队列也纳入同一个闸门。 */
    readonly afterChunk?: () => Promise<void>;
    /**
     * 每条目在摘要核对**之后**必须完成的额外异步证明（目前只有内层 Web 包验证）。
     *
     * 它挂在与摘要**同一条串行链**上，而不是另开一条并发链，这是内存边界的前提：链被 await 于每个
     * 输入块边界，因此同时存活的归档字节始终是一个条目。并发链会打破这一点——32 KiB 的块足以让
     * 两个验证同时展开各自的 ZIP，峰值翻倍且与条目数无关。
     *
     * `onEntry` 保持同步正是因为这条链存在：让 `onEntry` 可 await 会诱使实现把验证写在那里，而它
     * 在同步解包栈上，await 只挂起续体而不会真的让扫描交出控制权（见 `scanArchiveAsync` 里的注释）。
     */
    readonly verifyEntry?: (
      _manifest: LocalLibraryArchiveManifestV2,
      _entry: ScannedEntry,
    ) => Promise<void> | void;
  } = {},
): Promise<ScanResult> => {
  /**
   * 失败**存起来**而不是让链本身拒绝。
   *
   * 链在块边界被 await，因此第一个失败点本应是那次 await。但扫描自身也可能在同一趟里抛错（例如某个更
   * 早的条目触发了"清单未声明的条目"），那时循环已经跳出、链再也不会被 await，一个已拒绝的 promise
   * 就成了 unhandled rejection——它既不携带主错误的诊断，又会让 Node 在测试之外报一条无关的崩溃。
   *
   * 所以链**永不拒绝**：失败被记进 `verificationFailure`，由下一次 `afterChunk` 或扫描正常结束时抛出。
   * 记录第一个失败而不是最后一个，因为链条式执行会让后续任务继续跑，而用户该看到的是最早的原因。
   */
  let verificationFailure: unknown = null;
  let verifications: Promise<void> = Promise.resolve();
  const enqueueVerification = (task: () => Promise<void>): void => {
    verifications = verifications.then(task).catch((cause: unknown) => {
      verificationFailure ??= cause;
    });
  };
  const settleVerifications = (): void => {
    if (verificationFailure !== null) throw verificationFailure;
  };
  const result = await scanArchiveAsync(
    archive,
    budgets,
    (manifest, entry) => {
      const { bytes } = entry;
      enqueueVerification(async () => {
        const digest = await sha256DigestOfBytes(bytes);
        if (digest !== entry.declaredDigest) {
          throw fail(
            'archive-entry-corrupt',
            `归档条目摘要与清单声明不符：${entry.path} 声明 ${entry.declaredDigest}，实际 ${digest}`,
          );
        }
        await options.verifyEntry?.(manifest, entry);
      });
      onEntry(manifest, entry);
    },
    false,
    async () => {
      await verifications;
      settleVerifications();
      await options.afterChunk?.();
    },
  );
  settleVerifications();

  if (options.expectedManifestDigest !== undefined) {
    const manifestDigest = await sha256DigestOfBytes(result.manifestBytes);
    if (manifestDigest !== options.expectedManifestDigest) {
      throw fail(
        'archive-manifest-invalid',
        '归档的 manifest 与 preflight 读到的那份不是同一段字节',
      );
    }
  }
  return result;
};

const parseArchiveManifest = (bytes: Uint8Array): LocalLibraryArchiveManifestV2 => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw fail('archive-manifest-invalid', 'manifest.json 不是合法的 UTF-8');
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw fail('archive-manifest-invalid', 'manifest.json 不是合法 JSON');
  }
  const parsed = LocalLibraryArchiveManifestV2Schema.safeParse(value);
  if (!parsed.success) {
    throw fail(
      'archive-manifest-invalid',
      `manifest.json 未通过契约校验：${parsed.error.issues.map((issue) => issue.message).join('；')}`,
    );
  }
  return parsed.data;
};

/**
 * 记录 JSON 与清单声明的交叉核对。
 *
 * 清单里的 `cardId` / `contentDigest` 与记录里的同名字段是**两个来源**。它们不一致意味着这份归档
 * 自己前后矛盾，而症状会出现在"下次同步把这条记录当成新的"——离真正的原因很远。
 */
const readArchiveCardRecord = (
  entry: LocalLibraryArchiveCardEntryV2,
  bytes: Uint8Array,
): ReturnType<typeof parseLocalLibraryArchiveCard> => {
  let record: ReturnType<typeof parseLocalLibraryArchiveCard>;
  try {
    record = parseLocalLibraryArchiveCard(bytes);
  } catch {
    throw fail('archive-record-invalid', `归档条目不是合法的卡片记录：${entry.path}`);
  }
  if (record.id !== entry.cardId || record.contentDigest !== entry.contentDigest) {
    throw fail(
      'archive-entry-invalid',
      `卡片记录 ${entry.path} 的 id / contentDigest 与清单声明不符`,
    );
  }
  return record;
};

const readArchiveWebPackageRecord = (
  entry: LocalLibraryArchiveWebPackageEntryV2,
  bytes: Uint8Array,
): ReturnType<typeof parseLocalLibraryArchiveWebPackage> => {
  let record: ReturnType<typeof parseLocalLibraryArchiveWebPackage>;
  try {
    record = parseLocalLibraryArchiveWebPackage(bytes);
  } catch {
    throw fail('archive-record-invalid', `归档条目不是合法的 Web 包记录：${entry.path}`);
  }
  if (
    record.id !== entry.packageId
    || record.contentDigest !== entry.contentDigest
    || record.archiveByteLength !== entry.archiveByteLength
  ) {
    throw fail(
      'archive-entry-invalid',
      `Web 包记录 ${entry.path} 的 id / contentDigest / archiveByteLength 与清单声明不符`,
    );
  }
  return record;
};

/**
 * 证明一段 ZIP 字节确实是记录所声明的那个 Web 包。
 *
 * 归档的形状与自洽检查到此为止就已经全部通过：`archives/<sha256(bytes)>` 与 `archiveDigest` 一致，
 * 记录的 `id` / `contentDigest` / `archiveByteLength` 与清单一致，而记录契约又保证了
 * `contentDigest === ref.digest` 且 `id` 由 `ref.digest` 派生。**仍然**没有任何一处把那份 ZIP 的内容
 * 与 `ref.digest` 联系起来：于是构造者可以把包 X 的 ZIP 放进 `archives/<sha256(X)>`，让记录声明包 Y
 * 的身份与摘要，两边各自与清单自洽。落到目标机器上，存储层里是"名为 Y、实为 X"。
 *
 * 症状出现在很久之后且与根因无关：用户打开这个包，看到的是 X 的内容，而注册表里它的身份是 Y。
 *
 * 比较 `verified.ref.digest` 与 `record.ref.digest` 就够了，不必逐字段比清单——`ref.digest` 是
 * canonical manifest 的 SHA-256，两者相等即意味着两份 canonical manifest 相同（忽略碰撞）。
 */
const readArchiveWebPackageRefDigest = async (
  archivePath: string,
  archiveBytes: Uint8Array,
): Promise<string> => {
  try {
    return (await unpackWebPackageZip(archiveBytes)).ref.digest;
  } catch (cause) {
    throw fail(
      'archive-package-mismatch',
      `内层 Web 包 ZIP 无法通过 Web 包校验：${archivePath}（${describe(cause)}）`,
    );
  }
};

const requireArchiveWebPackageMatches = (
  archivePath: string,
  declared: string,
  actual: string,
): void => {
  if (actual === declared) return;
  throw fail(
    'archive-package-mismatch',
    `内层 Web 包 ZIP 与记录声明的包不是同一个：${archivePath} 声明 ${declared}，实际 ${actual}`,
  );
};

/**
 * 完整 preflight：形状、预算、摘要、记录自洽、**内层 Web 包归属**、冲突判定。**一次本地库写入都没有。**
 *
 * UI 的顺序因此只能是"先 inspect、把摘要与冲突条数给用户看、再 apply"。这条顺序不是流程偏好，
 * 而是 `DESK-074`"所有 preflight 在第一次 mutation 之前完成"的直接后果。
 */
export const inspectLocalLibraryArchive = async (
  target: LocalLibraryArchiveImportTarget,
  archive: Uint8Array,
  budgets: LocalLibraryArchiveImportBudgets = {},
): Promise<LocalLibraryArchiveImportPlan> => {
  const resolved = resolveBudgets(budgets);
  // 记录字节先留到摘要核对**之后**再解析：被篡改的字节往往连记录 schema 都过不了，于是
  // "这不是一条合法记录"会盖掉"这段字节与清单声明的摘要不符"——后者才是更接近根因的诊断。
  const recordBytes: Array<{ path: string; bytes: Uint8Array }> = [];
  // 索引先建好：清单里的 `path` 与归档里出现的路径是同一个键集合，因此**一次** O(n) 建表就把
  // 后面每次查找变成 O(1)。直接 `manifest.cards.find(...)` 会让整趟变成 O(n²)——而 n 由攻击者
  // 与清单上限共同决定，实测 n=8000 时单是查找就 493 ms，且随条目数每翻一倍变成四倍。
  //
  // 键只能建一次：`scanArchive` 的回调在清单解析之后才被调用（清单是第一个 entry），所以表在
  // 第一次回调时已经可用。
  let cardByPath = new Map<string, LocalLibraryArchiveCardEntryV2>();
  let packageByPath = new Map<string, LocalLibraryArchiveWebPackageEntryV2>();
  /**
   * `archivePath` → 该 ZIP 自己的 `ref.digest`。
   *
   * 验证在 ZIP 条目到达时立刻做（那时字节在手），只留下 64 个十六进制字符；记录可能还没到，而比较
   * 需要两侧，因此把 ZIP 一侧的结果存下来。反过来把 ZIP 字节留到记录到达时会占住整个 `archives/`
   * 命名空间——正是 `afterChunk` 闸门要防的那个量。
   */
  const verifiedArchiveDigests = new Map<string, string>();
  const { manifest, manifestBytes } = await scanArchive(
    archive,
    resolved,
    (parsed, { path, bytes }) => {
      if (cardByPath.size === 0) {
        cardByPath = new Map(parsed.cards.map((entry) => [entry.path, entry]));
        packageByPath = new Map(parsed.webPackages.map((entry) => [entry.path, entry]));
      }
      if (cardByPath.has(path) || packageByPath.has(path)) recordBytes.push({ path, bytes });
    },
    {
      verifyEntry: async (parsed, { path, bytes }) => {
        const owner = parsed.webPackages.find((candidate) => candidate.archivePath === path);
        if (owner === undefined) return;
        verifiedArchiveDigests.set(path, await readArchiveWebPackageRefDigest(path, bytes));
      },
    },
  );

  // 记录在 preflight 就必须解析并与清单交叉核对：等到 apply 才发现，冲突摘要与实际写入结果
  // 就会各说各话，而 UI 已经把"零冲突"说给用户听了。
  //
  // 解析结果被刻意丢弃——preflight 的义务是"证明这份归档自洽"，不是"把记录传下去"。apply 会
  // 在写入前重新解析，因此这里多解析一次是有意的重复，而不是遗漏。
  for (const { path, bytes } of recordBytes) {
    const card = cardByPath.get(path);
    if (card !== undefined) {
      readArchiveCardRecord(card, bytes);
      continue;
    }
    const pkg = packageByPath.get(path);
    if (pkg !== undefined) {
      const record = readArchiveWebPackageRecord(pkg, bytes);
      const archiveDigest = verifiedArchiveDigests.get(pkg.archivePath);
      if (archiveDigest === undefined) {
        throw fail(
          'archive-package-mismatch',
          `归档缺少 Web 包记录 ${pkg.packageId} 对应的 ZIP 条目：${pkg.archivePath}`,
        );
      }
      requireArchiveWebPackageMatches(pkg.archivePath, record.ref.digest, archiveDigest);
    }
  }

  // 已有记录用**一次分页列举**取，而不是逐条 `get`。逐条 `get` 是 O(n) 次串行 IPC 往返
  // （上限 10 万条时是 10 万次），而 `list` 本来就带 keyset 游标。
  //
  // `includeDeleted: true` 是必需的：墓碑也是"本地已存在"，因此 existing-wins 会保护它——
  // 而那正是导入**不应**做的事（复活一条用户删掉的记录）。逐条 `get` 恰好也对，因为端口契约
  // 说它"返回记录，包括墓碑"。
  const existingCardIds = await collectExistingIds(
    (cursor) => target.cards.list({
      includeDeleted: true,
      limit: EXISTENCE_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    }),
    (item) => item.id,
  );
  const existingWebPackageIds = await collectExistingIds(
    (cursor) => target.packages.list({
      includeDeleted: true,
      limit: EXISTENCE_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    }),
    (item) => item.id,
  );

  return {
    summary: {
      format: manifest.format,
      formatVersion: manifest.formatVersion,
      exportedAt: manifest.exportedAt,
      cardCount: manifest.cardCount,
      webPackageCount: manifest.webPackageCount,
      cardSchemaVersion: manifest.cardSchemaVersion,
      webPackageSchemaVersion: manifest.webPackageSchemaVersion,
    },
    manifest,
    manifestDigest: await sha256DigestOfBytes(manifestBytes),
    existingCardIds,
    existingWebPackageIds,
  };
};

const byKindThenId = (
  left: { kind: string; id: string },
  right: { kind: string; id: string },
): number => (left.kind === right.kind ? compareIds(left.id, right.id) : left.kind < right.kind ? -1 : 1);

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * 按 plan 写入本地库。
 *
 * 顺序由 `plan.manifest` 的声明顺序决定，而导出侧的清单是按 `path` 排过的，因此同一份归档两次
 * 导入的报告**逐条相同**。确定的顺序让"报告可以与上一次逐条比对"这件事成立，而"顺序由到达顺序
 * 决定"会让它不可靠。
 *
 * **existing wins** 在这里才生效：本地已有的记录一律跳过并逐条列出。`DESK-074` 禁止"时间新的赢"
 * 与强制覆盖——本地库的时间戳单调、tombstone 与 non-monotonic timestamp 不变量已经让"强行恢复旧
 * 状态"需要额外定义，而猜错的后果是静默丢失用户刚做的删除。
 *
 * 单条失败只记进报告、不中止其余条目，也不整体回滚——为此引入跨 SQLite 与 blob 文件系统的全局
 * 事务会破坏 `ADR-desktop-tauri-v1` 第 7 条的职责分层（`DESK-074`）。
 */
export const applyLocalLibraryArchiveImport = async (
  target: LocalLibraryArchiveImportTarget,
  archive: Uint8Array,
  plan: LocalLibraryArchiveImportPlan,
  budgets: LocalLibraryArchiveImportBudgets = {},
): Promise<LocalLibraryArchiveImportReport> => {
  const resolved = resolveBudgets(budgets);
  /**
   * 跳过判定在**写入前**重新读一次存储，而不是只信任 `plan`。
   *
   * `plan` 是一个普通导出接口，因此"用 A 库的 plan 去写 B 库"在类型层面完全合法，而那会静默
   * 覆盖——正是 `DESK-074` 禁止的强制覆盖。反过来，inspect 与 apply 之间本地库也可能变化
   * （一次同步落库、一次 purge），陈旧的 plan 会让已经不在的记录被报成"已存在"而不再写入。
   *
   * 因此 `plan` 里的两个集合只用于**写入前**的摘要展示，apply 自己按存储的当前状态决定跳过。
   */
  const succeededCardIds: string[] = [];
  const succeededWebPackageIds: string[] = [];
  const skipped: LocalLibraryArchiveImportSkip[] = [];
  const failed: LocalLibraryArchiveImportFailure[] = [];

  const cardByPath = new Map(plan.manifest.cards.map((entry) => [entry.path, entry]));
  const packageByPath = new Map(plan.manifest.webPackages.map((entry) => [entry.path, entry]));
  const packageByArchivePath = new Map(
    plan.manifest.webPackages.map((entry) => [entry.archivePath, entry]),
  );

  /**
   * 已解出但还没有配对完成的两半。
   *
   * 一个 Web 包的写入需要"记录 JSON"与"ZIP 字节"两半，而它们在归档里相隔整个 `archives/` 命名
   * 空间。打包器的条目顺序是"卡片记录 → Web 包记录 → 归档字节"，因此记录先到、归档后到。
   *
   * 代价要写清楚：记录是**每包一份**地留在 map 里，条目数上限（100_000）下就是几十 MB，
   * 而不是"几十 KiB"。这是可接受的——记录本身是几百字节量级，而真正大的 ZIP 字节是**边解边写**
   * 的：每个输入块边界都会 await 写入队列（见下面的 `afterChunk`），因此在途的归档字节不超过
   * 一个块。
   */
  const pendingRecords = new Map<string, Uint8Array>();
  const pendingArchiveBytes = new Map<string, Uint8Array>();

  /** 串行写入队列的尾部。await 它就是在途内存的闸门。 */
  let tail: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): void => {
    tail = tail.then(task);
  };

  const flushWebPackageIfComplete = (entry: LocalLibraryArchiveWebPackageEntryV2): void => {
    const recordBytes = pendingRecords.get(entry.path);
    const archiveBytes = pendingArchiveBytes.get(entry.archivePath);
    if (recordBytes === undefined || archiveBytes === undefined) return;
    pendingRecords.delete(entry.path);
    pendingArchiveBytes.delete(entry.archivePath);
    enqueue(async () => {
      try {
        // 这一次 `get` 是**预筛**，不是判定依据：已存在的包不会被写入，因此也没有必要为它付出内层
        // 验证的代价。真正的判定在下面的 `putIfAbsent`：若条目在两步之间被删掉，它会正常
        // 写入；若被新增写入，它会报已存在。两种情形都正确，而前者把判定留在 `get` 上时不正确。
        if (await target.packages.get(entry.packageId) !== null) {
          skipped.push({ kind: 'web-package', id: entry.packageId, reason: 'already-present' });
          return;
        }
        const record = readArchiveWebPackageRecord(entry, recordBytes);
        // 写入前证明归属。此处不能只依赖 preflight：apply 是导出接口，它只校验 manifest 摘要与 `plan` 相同，
        // 而不曾重跑内层验证。
        requireArchiveWebPackageMatches(
          entry.archivePath,
          record.ref.digest,
          await readArchiveWebPackageRefDigest(entry.archivePath, archiveBytes),
        );
        const outcome = await target.packages.putIfAbsent(record, archiveBytes);
        if ('alreadyPresent' in outcome) {
          skipped.push({ kind: 'web-package', id: entry.packageId, reason: 'already-present' });
          return;
        }
        succeededWebPackageIds.push(entry.packageId);
      } catch (cause) {
        failed.push({ kind: 'web-package', id: entry.packageId, reason: describeWriteFailure(cause) });
      }
    });
  };

  // 清单身份**先**核对：它是 preflight 展示给用户的那一份摘要的来源，而"展示的清单"与
  // "实际写入的归档"不是同一份，正是最难排查的一种不一致。扫描只读到清单结束就停，因此这
  // 一步的开销与归档大小无关。
  const declared = await scanArchiveAsync(archive, resolved, () => undefined, true);
  const declaredDigest = await sha256DigestOfBytes(declared.manifestBytes);
  if (declaredDigest !== plan.manifestDigest) {
    throw fail(
      'archive-manifest-invalid',
      '归档的 manifest 与 preflight 读到的那份不是同一段字节',
    );
  }

  try {
    await scanArchive(
      archive,
      resolved,
      // 查找一律走 `plan.manifest` 建好的索引，而不是 `parsed`：上面刚核对过两者的摘要相等，
      // 因此它们是同一份清单，而 `parsed` 上的线性查找会让条目数变成 O(n²)。
      (_parsed, { path, bytes }) => {
        const card = cardByPath.get(path);
        if (card !== undefined) {
          enqueue(async () => {
            try {
              // 跳过判定来自 `putIfAbsent` 的结果，而不是写入前的 `get`。两者的差别就是原子性：
              // `get` 与 `put` 之间可以插进来一个写者，而它们之间没有事实可以插进来。
              const outcome = await target.cards.putIfAbsent(readArchiveCardRecord(card, bytes));
              if ('alreadyPresent' in outcome) {
                skipped.push({ kind: 'card', id: card.cardId, reason: 'already-present' });
                return;
              }
              succeededCardIds.push(card.cardId);
            } catch (cause) {
              failed.push({ kind: 'card', id: card.cardId, reason: describeWriteFailure(cause) });
            }
          });
          return;
        }

        const pkg = packageByPath.get(path);
        if (pkg !== undefined) {
          pendingRecords.set(path, bytes);
          flushWebPackageIfComplete(pkg);
          return;
        }

        const owner = packageByArchivePath.get(path);
        if (owner === undefined) return;
        pendingArchiveBytes.set(path, bytes);
        flushWebPackageIfComplete(owner);
      },
      {
        expectedManifestDigest: plan.manifestDigest,
        // 每个输入块之后都让写入队列清空：在途的归档字节因此不超过一个块，而不是整个 `archives/`
        // 命名空间。摘要在同一条接缝上 await（见 `scanArchive`）。
        afterChunk: () => tail,
      },
    );
  } finally {
    // 写入队列**必须**在异常路径上也被排空：扫描中途失败时，已经入队的写入仍然会执行，
    // 若不 await 就 return，用户既看不到报告、也不知道库里已经落了什么。
    await tail;
  }

  // 每个被声明的条目都必须有下落：succeeded、skipped、failed 三者之一。缺一条意味着"导入成功"
  // 却少了东西，而那正是这份报告唯一不允许的失败模式。
  //
  // 键带 kind：`LocalCardIdSchema` 只是 `z.string().trim().min(1).max(256)`，不强制 `lc_` 前缀，
  // 因此一份构造过的归档可以让某个包的 id 与某张卡的 id 相同，只按 id 记账会让这张网放行一个
  // 从未被处理的包。
  const accounted = new Set([
    ...succeededCardIds.map((id) => `card:${id}`),
    ...succeededWebPackageIds.map((id) => `web-package:${id}`),
    ...skipped.map((item) => `${item.kind}:${item.id}`),
    ...failed.map((item) => `${item.kind}:${item.id}`),
  ]);
  for (const entry of plan.manifest.cards) {
    if (!accounted.has(`card:${entry.cardId}`)) {
      failed.push({ kind: 'card', id: entry.cardId, reason: '该条目在导入过程中未被处理' });
    }
  }
  for (const entry of plan.manifest.webPackages) {
    if (!accounted.has(`web-package:${entry.packageId}`)) {
      failed.push({ kind: 'web-package', id: entry.packageId, reason: '该条目在导入过程中未被处理' });
    }
  }

  return {
    succeededCardIds: [...succeededCardIds].sort(compareIds),
    succeededWebPackageIds: [...succeededWebPackageIds].sort(compareIds),
    skipped: [...skipped].sort(byKindThenId),
    failed: [...failed].sort(byKindThenId),
  };
};
