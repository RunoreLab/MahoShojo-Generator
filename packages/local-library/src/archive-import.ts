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
 * 它同时界定"一次 `push` 最多让解包器交付多少字节"，因此是内存边界的组成部分而不是性能参数。
 * apply 在块之间让出事件循环并等写入队列清空，块越大吞吐越高、在途条目越多——取 4 MiB 是因为
 * 256 MiB 归档下只有 64 次让出，而单次让出要等一次真实的异步写入。
 */
const STREAM_CHUNK_BYTES = 4 * 1024 * 1024;

/** 归档内允许出现的路径命名空间。清单不在这里——它是第一个 entry，单独判定。 */
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
const scanArchiveSync = (
  archive: Uint8Array,
  budgets: ResolvedBudgets,
  onEntry: (_manifest: LocalLibraryArchiveManifestV2, _entry: ScannedEntry) => void,
  stopAfterManifest = false,
): ScanResult => {
  const declaredByPath = new Map<string, { byteLength: number; digest: string }>();
  const seenPaths = new Set<string>();

  let manifest: LocalLibraryArchiveManifestV2 | null = null;
  let manifestBytes: Uint8Array = new Uint8Array();

  let entryCount = 0;
  let totalActualBytes = 0;

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
    const bytes = buffer;
    const length = buffered;
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
      totalActualBytes += expected.byteLength;
      if (totalActualBytes > budgets.maxTotalBytes) {
        throw fail(
          'archive-budget-exceeded',
          `归档声明总字节超过预算：${totalActualBytes} > ${budgets.maxTotalBytes}`,
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
        totalActualBytes += data.byteLength;
        // 预算守卫与单条目长度守卫的**先后顺序是有意义的**，因此它排在前面：当攻击者给一个条目
        // 谎报一个巨大长度时，预算先响，报的是"这个归档太大"；而谎报一个小长度时预算不会响，
        // 随后由单条目守卫报"这条比清单声称的长"。两种情况都带走了解压预算，只是一条归档级的
        // 诊断，一条条目级的。
        if (totalActualBytes > budgets.maxTotalBytes) {
          throw fail(
            'archive-budget-exceeded',
            `归档实际解压字节超过预算：${totalActualBytes} > ${budgets.maxTotalBytes}`,
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
        const next = new Uint8Array(buffered + data.byteLength);
        next.set(buffer, 0);
        next.set(data, buffered);
        buffer = next;
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

  for (let offset = 0; offset < archive.byteLength; offset += STREAM_CHUNK_BYTES) {
    if (stopAfterManifest && manifest !== null) break;
    const end = Math.min(offset + STREAM_CHUNK_BYTES, archive.byteLength);
    unzip.push(archive.subarray(offset, end), end >= archive.byteLength);
  }

  if (stopAfterManifest) {
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
 * 扫描 + 摘要核对。
 *
 * 摘要不能在同一趟里同步完成（解包器同步、摘要算子异步），因此在每个条目结束时立刻把字节交给
 * `crypto.subtle` 并丢掉自己的引用，最后统一 `await`。峰值因此仍是**一个条目**，而不是"全部条目
 * 加上待办 promise"。
 *
 * `crypto.subtle` 在调用时复制 buffer（WebCrypto 的算法接收的是副本），因此丢弃引用是安全的。
 * 这条依赖写在这里，是因为它一旦被破坏，症状是"偶发的摘要把关失败"——极难定位。
 */
const scanArchive = async (
  archive: Uint8Array,
  budgets: ResolvedBudgets,
  onEntry: (_manifest: LocalLibraryArchiveManifestV2, _entry: ScannedEntry) => void,
  expectedManifestDigest?: string,
): Promise<ScanResult> => {
  const digests: Array<Promise<void>> = [];
  const result = scanArchiveSync(archive, budgets, (manifest, entry) => {
    digests.push(
      sha256DigestOfBytes(entry.bytes).then((digest) => {
        if (digest !== entry.declaredDigest) {
          throw fail(
            'archive-entry-corrupt',
            `归档条目摘要与清单声明不符：${entry.path} 声明 ${entry.declaredDigest}，实际 ${digest}`,
          );
        }
      }),
    );
    onEntry(manifest, entry);
  });

  if (expectedManifestDigest !== undefined) {
    digests.push(
      sha256DigestOfBytes(result.manifestBytes).then((digest) => {
        if (digest !== expectedManifestDigest) {
          throw fail(
            'archive-manifest-invalid',
            '归档的 manifest 与 preflight 读到的那份不是同一段字节',
          );
        }
      }),
    );
  }

  // `allSettled` 而不是 `all`：一个条目摘要不符不该让其余条目被顺带判成通过或失败。
  const settled = await Promise.allSettled(digests);
  const failure = settled.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
  );
  if (failure !== undefined) {
    throw failure.reason instanceof LocalLibraryArchiveImportError
      ? failure.reason
      : fail('archive-malformed', `归档校验失败：${describe(failure.reason)}`);
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
 * 完整 preflight：形状、预算、摘要、记录自洽、冲突判定。**一次本地库写入都没有。**
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
  const { manifest, manifestBytes } = await scanArchive(
    archive,
    resolved,
    (parsed, { path, bytes }) => {
      const isRecord = parsed.cards.some((entry) => entry.path === path)
        || parsed.webPackages.some((entry) => entry.path === path);
      if (isRecord) recordBytes.push({ path, bytes });
    },
  );

  // 记录在 preflight 就必须解析并与清单交叉核对：等到 apply 才发现，冲突摘要与实际写入结果
  // 就会各说各话，而 UI 已经把"零冲突"说给用户听了。
  for (const { path, bytes } of recordBytes) {
    const card = manifest.cards.find((entry) => entry.path === path);
    if (card !== undefined) {
      readArchiveCardRecord(card, bytes);
      continue;
    }
    const pkg = manifest.webPackages.find((entry) => entry.path === path);
    if (pkg !== undefined) readArchiveWebPackageRecord(pkg, bytes);
  }

  const existingCardIds: string[] = [];
  for (const entry of manifest.cards) {
    if (await target.cards.get(entry.cardId) !== null) existingCardIds.push(entry.cardId);
  }
  const existingWebPackageIds: string[] = [];
  for (const entry of manifest.webPackages) {
    if (await target.packages.get(entry.packageId) !== null) {
      existingWebPackageIds.push(entry.packageId);
    }
  }

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
  const skippedCards = new Set(plan.existingCardIds);
  const skippedPackages = new Set(plan.existingWebPackageIds);

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
   * 空间。打包器的条目顺序是"卡片记录 → Web 包记录 → 归档字节"，因此记录先到、归档后到，一个包
   * 真正占住内存的只有它的 ZIP；记录每个几百字节，全部留着也只是几十 KiB 量级。反序的归档会把
   * ZIP 留在 map 里直到它的记录出现——同样是"在途"，而不是"全部"。
   */
  const pendingRecords = new Map<string, Uint8Array>();
  const pendingArchiveBytes = new Map<string, Uint8Array>();

  /** 串行写入队列的尾部。`await` 它就是在途内存的闸门。 */
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
        await target.packages.put(readArchiveWebPackageRecord(entry, recordBytes), archiveBytes);
        succeededWebPackageIds.push(entry.packageId);
      } catch (cause) {
        failed.push({ kind: 'web-package', id: entry.packageId, reason: describe(cause) });
      }
    });
  };

  // 清单身份**先**核对：它是 preflight 展示给用户的那一份摘要的来源，而"展示的清单"与
  // "实际写入的归档"不是同一份，正是最难排查的一种不一致。扫描只读到清单结束就停，因此这
  // 一步的开销与归档大小无关。
  const declared = scanArchiveSync(archive, resolved, () => undefined, true);
  const declaredDigest = await sha256DigestOfBytes(declared.manifestBytes);
  if (declaredDigest !== plan.manifestDigest) {
    throw fail(
      'archive-manifest-invalid',
      '归档的 manifest 与 preflight 读到的那份不是同一段字节',
    );
  }

  await scanArchive(
    archive,
    resolved,
    // 查找一律走 `plan.manifest` 建好的索引，而不是 `parsed`：上面刚核对过两者的摘要相等，
    // 因此它们是同一份清单，而 `parsed` 上的线性查找会让条目数变成 O(n²)。
    (_parsed, { path, bytes }) => {
      const card = cardByPath.get(path);
      if (card !== undefined) {
        if (skippedCards.has(card.cardId)) {
          skipped.push({ kind: 'card', id: card.cardId, reason: 'already-present' });
          return;
        }
        enqueue(async () => {
          try {
            await target.cards.put(readArchiveCardRecord(card, bytes));
            succeededCardIds.push(card.cardId);
          } catch (cause) {
            failed.push({ kind: 'card', id: card.cardId, reason: describe(cause) });
          }
        });
        return;
      }

      const pkg = packageByPath.get(path);
      if (pkg !== undefined) {
        if (skippedPackages.has(pkg.packageId)) {
          skipped.push({ kind: 'web-package', id: pkg.packageId, reason: 'already-present' });
          pendingArchiveBytes.delete(pkg.archivePath);
          return;
        }
        pendingRecords.set(path, bytes);
        flushWebPackageIfComplete(pkg);
        return;
      }

      const owner = packageByArchivePath.get(path);
      if (owner === undefined) return;
      if (skippedPackages.has(owner.packageId)) return;
      pendingArchiveBytes.set(path, bytes);
      flushWebPackageIfComplete(owner);
    },
    plan.manifestDigest,
  );
  await tail;

  // 每个被声明的条目都必须有下落：succeeded、skipped、failed 三者之一。缺一条意味着"导入成功"
  // 却少了东西，而那正是这份报告唯一不允许的失败模式。
  const accounted = new Set([
    ...succeededCardIds,
    ...succeededWebPackageIds,
    ...skipped.map((item) => item.id),
    ...failed.map((item) => item.id),
  ]);
  for (const entry of plan.manifest.cards) {
    if (!accounted.has(entry.cardId)) {
      failed.push({ kind: 'card', id: entry.cardId, reason: '该条目在导入过程中未被处理' });
    }
  }
  for (const entry of plan.manifest.webPackages) {
    if (!accounted.has(entry.packageId)) {
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
