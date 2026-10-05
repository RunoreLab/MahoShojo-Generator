import { collectLocalLibraryArchive } from '@mahoshojo/local-library/archive-export';
import {
  MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES,
  MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES,
  packLocalLibraryArchive,
} from '@mahoshojo/local-library/archive-pack';
import {
  applyLocalLibraryArchiveImport,
  inspectLocalLibraryArchive,
  LocalLibraryArchiveImportError,
} from '@mahoshojo/local-library/archive-import';
import type {
  LocalLibraryArchiveImportPlan,
  LocalLibraryArchiveImportReport,
} from '@mahoshojo/local-library/archive-import';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { WebPackageRepository } from '@mahoshojo/local-library/web-package-record';
import type {
  ArchiveExportOutcome,
  ArchiveExportProgress,
  LocalArchiveHost,
} from '@mahoshojo/ui-web/local-archive';

import { downloadBlob } from '@/lib/client/blobUrl';
import { getLocalCardRepository } from './card-repository';
import { getLocalWebPackageRepository } from './web-package-repository';
import { probeLocalLibraryStorage } from './storage-probe';

/**
 * Web 侧的本地库归档 adapter。
 *
 * 它是 D2.3d 的「既有浏览器 adapter」那一半：共享界面与状态机由 `@mahoshojo/ui-web/local-archive`
 * 提供，本文件只负责把 IndexedDB 仓储与浏览器文件能力接上去。**这里不复制任何业务解析**——预检、冲突
 * 判定、摘要与解压全在 `@mahoshojo/local-library` 里，两端跑的是同一份代码。
 *
 * ## 能力面：零新增
 *
 * 导出走 `packLocalLibraryArchive` + `downloadBlob`（一个 `<a download>` 点击），导入走
 * `<input type="file">` + `File.arrayBuffer()`。两者都是 WebView/浏览器标准能力，不需要任何权限，也
 * 不给 renderer 任意路径（`DESK-053`）。因此 Web 侧接归档 UI 不需要新增任何 native 能力。
 */

/**
 * 导入侧的长度上限。
 *
 * 取 **OUTPUT** 上限（最终归档文件长度）而不是 INPUT 上限（打包输入总量）。`DESK-070` 把两者定义为
 * 不同的维度并明确 MUST NOT 互相充当：被度量的是用户手里的那个文件，而 `file.size` 正是它的长度。
 * 两者今天同值，但用错维度会让将来任何一次调整都变成「导入比导出更早拒绝」的静默不一致。
 */
export const WEB_LIBRARY_ARCHIVE_LIMITS = {
  fileBytes: MAX_LOCAL_LIBRARY_ARCHIVE_OUTPUT_BYTES,
} as const;

/**
 * 把 `<input type="file">` 选中的文件读成字节。
 *
 * 读之前先按 `file.size` 拒绝超限文件：这一层不解压任何东西，因此它能在**分配之前**拒掉一个明显过大的
 * 文件，而共享导入模块里的预算守卫要等到第一条 entry 开始解压才生效。
 *
 * `file.size` 与实际读取长度**都要**核对。浏览器的 `File` 来自不可信输入（拖放、共享、扩展），而一个
 * 谎报长度的文件会让「按长度分配的缓冲区」变成一段截断数据——症状是解包器报 ZIP 损坏。
 */
export const readArchiveFileBytes = async (file: File): Promise<Uint8Array> => {
  if (file.size > WEB_LIBRARY_ARCHIVE_LIMITS.fileBytes) {
    throw new LocalLibraryArchiveImportError(
      'archive-budget-exceeded',
      `文件超过导入上限：${file.size} > ${WEB_LIBRARY_ARCHIVE_LIMITS.fileBytes} 字节`,
    );
  }
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength !== file.size) {
    throw new LocalLibraryArchiveImportError(
      'archive-malformed',
      `文件实际长度与声明不符：声明 ${file.size}，实际 ${buffer.byteLength}`,
    );
  }
  return new Uint8Array(buffer);
};

/**
 * 打开一个文件选择器并读出选中的字节；用户取消返回 `null`。
 *
 * 用动态创建而不是 JSX 里的隐藏 `<input>`：这个 adapter 必须能从任意回调里被调用（共享状态机的
 * `pickArchiveBytes` 是一个普通函数），而一个已经在 DOM 里的 input 会让「当前选中的文件」与
 * 「界面上的 input」产生两份状态。
 *
 * `accept` 只做**筛选提示**，不是校验——真正的判定在 `readArchiveFileBytes` 与共享导入模块里。把
 * accept 当成校验会让人用一个改名后的文件绕过它。
 *
 * ## 取消与读取失败必须走两条不同的路
 *
 * 取消 → resolve `null`（不是错误；用户改主意了）。
 * 读取失败（超限、长度对不上）→ **reject**，让上层写进错误通道。
 *
 * 两者混同的后果很具体：用户挑了一个 500 MiB 的文件，界面什么都不发生，也没有任何解释——一个
 * "点了没反应"的文件选择器比一个明确的「文件超过上限」糟糕得多。
 */
const pickArchiveBytes = async (): Promise<Uint8Array | null> => {
  if (typeof document === 'undefined') return null;

  return new Promise<Uint8Array | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.style.display = 'none';

    let settled = false;
    const finish = (value: Uint8Array | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    const fail = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      input.remove();
      reject(cause);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      readArchiveFileBytes(file).then(finish, fail);
    });

    // `cancel` 事件在现代浏览器上可用，但并非全部；因此焦点回到窗口时也要兜底判一次。
    input.addEventListener('cancel', () => finish(null));
    window.addEventListener(
      'focus',
      () => {
        window.setTimeout(() => {
          if (!settled && input.files?.length === 0) finish(null);
        }, 0);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
};

/**
 * 导出用的读取面。
 *
 * 分页 MUST 传 `includeDeleted: true`：portable archive 必须携带墓碑，否则导入侧看不到「这条被删过」，
 * 而下一次同步会把它当新记录重新拉回来。`DESK-074` 的 existing-wins 冲突策略依赖 `deletedAt`。
 *
 * `readWebPackageArchive` 按 **manifest 摘要**而不是包 id 调用，与既有约定一致。
 */
const createExportSource = (
  cards: CardRepository,
  packages: WebPackageRepository,
) => ({
  listCards: async (cursor?: string) => {
    const page = await cards.list({ includeDeleted: true, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    return { items: page.items, nextCursor: page.nextCursor };
  },
  listWebPackages: async (cursor?: string) => {
    const page = await packages.list({ includeDeleted: true, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    return { items: page.items, nextCursor: page.nextCursor };
  },
  readWebPackageArchive: async (packageId: string) => {
    const record = await packages.get(packageId);
    if (record === null) throw new Error(`Web 包不存在：${packageId}`);
    const bytes = await packages.readArchive(record.ref.digest);
    if (bytes === null) {
      // 记录在但字节不在。报告它而不是跳过：跳过的结果是一个「少一个包但能打开」的归档。
      throw new Error(`Web 包字节缺失：${packageId}`);
    }
    return bytes;
  },
});

const buildFileName = (exportedAt: string): string => {
  // 只取日期部分。带时分秒会让文件名在同一天多次导出时难以区分，而归档内容本身已经带精确时间戳。
  const day = exportedAt.slice(0, 10);
  return `mahoshojo-local-library-${day}.zip`;
};

/**
 * 把归档字节包装成 `BlobPart`，**不复制**。
 *
 * TypeScript 5.7 起 `Uint8Array` 的类型参数化了 buffer 类型，而 `BlobPart` 只接受
 * `ArrayBufferView<ArrayBuffer>`；打包器给出的是 `Uint8Array<ArrayBufferLike>`，类型上不兼容。
 *
 * 用 `new Uint8Array(buffer, byteOffset, byteLength)` 重新包一个视图而不是 `slice()` 或
 * `new Uint8Array(bytes)`：那两种写法会**复制整份归档**，而它最大可达 256 MiB——一次纯类型问题
 * 不该换来几百 MiB 的额外分配。同时显式传 `byteOffset` / `byteLength`，在 `zipSync` 返回的是更大
 * 缓冲区的一段视图时也不会把多余字节写进 ZIP。
 */
const asBlobPart = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);

/**
 * 构造 Web 侧的共享归档 host。
 *
 * `onProgress` 在这里**不会被调用**，而且这是刻意的：`packLocalLibraryArchive` 内部是同步 `zipSync`，
 * 整个归档在一次调用里产出，没有任何中间字节可以上报。共享状态机因此呈现不确定态而不是编造百分比
 * （见 `contract.ts` 里 `ArchiveExportProgress` 的说明）。
 *
 * 成功与否只由本函数是否正常返回决定：`downloadBlob` 之后浏览器已经把文件交给用户，本地没有任何
 * "落盘确认"可拿。把「已触发下载」当成 native 的最终确认是不同性质的事，因此文案上由本函数产出的
 * `location` 明确是文件名而非路径。
 */
export const createWebArchiveHost = (): LocalArchiveHost => {
  const cards = getLocalCardRepository();
  const packages = getLocalWebPackageRepository();

  return {
    probeStorage: probeLocalLibraryStorage,

    runExport: async (onProgress?: (progress: ArchiveExportProgress) => void): Promise<ArchiveExportOutcome> => {
      onProgress?.({ kind: 'indeterminate' });

      const collected = await collectLocalLibraryArchive(createExportSource(cards, packages));
      const packed = await packLocalLibraryArchive(collected.manifest, collected.read, {
        maxTotalBytes: MAX_LOCAL_LIBRARY_ARCHIVE_INPUT_BYTES,
      });

      const fileName = buildFileName(collected.manifest.exportedAt);
      downloadBlob(new Blob([asBlobPart(packed.bytes)], { type: 'application/zip' }), fileName);

      return { location: fileName, byteLength: packed.bytes.byteLength, entryCount: packed.entryCount };
    },

    pickArchiveBytes: pickArchiveBytes,

    inspectArchive: (archive: Uint8Array): Promise<LocalLibraryArchiveImportPlan> =>
      inspectLocalLibraryArchive({ cards, packages }, archive),

    applyArchive: (
      archive: Uint8Array,
      plan: LocalLibraryArchiveImportPlan,
    ): Promise<LocalLibraryArchiveImportReport> => applyLocalLibraryArchiveImport({ cards, packages }, archive, plan),

    describeError: (cause: unknown): string => {
      if (cause instanceof LocalLibraryArchiveImportError) return cause.message;
      if (cause instanceof Error) return cause.message;
      return '归档操作失败';
    },
  };
};