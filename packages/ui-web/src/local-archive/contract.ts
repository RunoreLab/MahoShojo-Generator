import type {
  LocalLibraryArchiveImportPlan,
  LocalLibraryArchiveImportReport,
} from '@mahoshojo/local-library/archive-import';

/**
 * 共源归档界面的视图契约。
 *
 * ## 形状照抄仓内已验证的先例
 *
 * 它沿用 `apps/web/components/arena/editor/features/web-package/web-package-contract.ts` 的归一化
 * view-model + `actions: Readonly<{...}>` + 独立错误通道的形状，而不是另发明一种。那套形状已经在两个
 * adapter 上跑通，并且已经编码了两条本模块同样需要的规则：
 *
 * 1. **「读不到」与「是空的」是两个 channel。** `storageError` 与 `exportError` 分开，否则一次存储
 *    初始化失败会被渲染成「本地库是空的」，而 `DESK-PROD-003` 明确禁止把失败显示成「没有数据」。
 * 2. **action 失败时 resolve 而非 reject。** 否则 `void action().then(...)` 会变成未处理的 rejection。
 *
 * ## 视图不 import 任何存储
 *
 * 本模块对归档契约只做 `import type`。运行时导入（解包、摘要、写入）全部由两端 adapter 承担，因此
 * 渲染一个预检摘要不需要把 `fflate` / `zod` 拉进这条依赖链，也让本视图可以脱离存储单独测试。
 */

/**
 * 导出进度。
 *
 * 用可辨识 union 而不是 `{ written, total } | null`，是为了让「假进度」在类型上无法表达：宿主要么
 * 给出真实的字节计数，要么明确声明这次导出没有可报告的中间进度。
 *
 * 这不是洁癖。Desktop 侧导出走 `append_local_archive_export_chunk` 分块写入，能给出真实字节进度；
 * 而 Web 侧的 `packLocalLibraryArchive` 内部是同步 `zipSync`，**没有**任何中间进度可报。两侧如果共用
 * 一个 `{written,total}` 形状，Web 就只能编一个假的进度条——而 D2.3d 的门禁恰恰要求「导出结果只以
 * native 最终完成确认判成功」，`DESK-PROD-005` 也禁止伪造成功。`indeterminate` 让「这次不知道进度」
 * 成为一个必须明说的选项。
 */
export type ArchiveExportProgress =
  | { readonly kind: 'indeterminate' }
  | { readonly kind: 'determinate'; readonly written: number; readonly total: number };

export interface ArchiveExportOutcome {
  /** 产物位置。Web 是文件名，Desktop 是最终绝对路径；文案由宿主决定，视图只显示。 */
  readonly location: string;
  readonly byteLength: number;
  readonly entryCount: number;
}

export interface LocalArchiveModel {
  /** 存储是否可用。不可用时整个界面进入只读说明态，而不是显示「空库」。 */
  readonly storageError: string | null;
  readonly exporting: boolean;
  readonly exportProgress: ArchiveExportProgress | null;
  readonly exportError: string | null;
  readonly lastExport: ArchiveExportOutcome | null;

  readonly inspecting: boolean;
  readonly importError: string | null;
  /** 预检结果。**必须先展示它再让用户决定是否写入**（`DESK-052`）。 */
  readonly plan: LocalLibraryArchiveImportPlan | null;
  readonly applying: boolean;
  readonly report: LocalLibraryArchiveImportReport | null;
}

export interface LocalArchiveActions {
  readonly startExport: () => void;
  readonly pickImportFile: () => void;
  /** 用户在看完预检摘要之后才被允许调用；未确认时视图不暴露它。 */
  readonly confirmImport: () => void;
  readonly cancelImport: () => void;
  readonly reset: () => void;
}

export type LocalArchiveView = Readonly<{
  model: LocalArchiveModel;
  actions: Readonly<LocalArchiveActions>;
  limits: Readonly<{ maxArchiveBytes: number }>;
}>;

/**
 * 预检摘要的展示投影。
 *
 * 「会有多少条被跳过」是从 `plan` **推导**出来的，而不是让 adapter 自己算一遍并传进来：算错的话，
 * 用户看到的跳过数就会与实际写入结果不一致，而那正是 `DESK-052` 要求预检展示的核心信息。
 */
export interface ArchivePreflightView {
  readonly format: string;
  readonly formatVersion: number;
  readonly exportedAt: string;
  readonly cardCount: number;
  readonly webPackageCount: number;
  readonly skippedCardCount: number;
  readonly skippedWebPackageCount: number;
  readonly willWriteCardCount: number;
  readonly willWriteWebPackageCount: number;
}

export const toArchivePreflightView = (
  plan: LocalLibraryArchiveImportPlan,
): ArchivePreflightView => {
  // existing-wins 的跳过判定是「归档里的 id 已经存在于本机」。因此跳过数 = 两个 id 集合的交集大小，
  // 不能拿 `existingCardIds.length` 直接当跳过数：那个列表是本机**全部**已有 id，其中多数与这份归档
  // 无关。数错会让「将跳过 N 条」与随后的实际报告对不上，而用户正是靠这个数字决定要不要导入。
  const existingCardIds = new Set(plan.existingCardIds);
  const existingWebPackageIds = new Set(plan.existingWebPackageIds);

  const skippedCardCount = plan.manifest.cards.filter((entry) =>
    existingCardIds.has(entry.cardId),
  ).length;
  const skippedWebPackageCount = plan.manifest.webPackages.filter((entry) =>
    existingWebPackageIds.has(entry.packageId),
  ).length;

  // 基数取 `summary`（manifest 自述，由 `.strict()` + `superRefine` 保证与数组长度一致），
  // 减去交集大小。用 `Math.max(0, …)` 兜底：交集不可能超过总数，但一旦上游契约变化让两者脱钩，
  // 展示负数比展示一个略微偏大的数字更容易被误读成"数据坏了"。
  const cardCount = plan.summary.cardCount;
  const webPackageCount = plan.summary.webPackageCount;

  return {
    format: plan.summary.format,
    formatVersion: plan.summary.formatVersion,
    exportedAt: plan.summary.exportedAt,
    cardCount,
    webPackageCount,
    skippedCardCount,
    skippedWebPackageCount,
    willWriteCardCount: Math.max(0, cardCount - skippedCardCount),
    willWriteWebPackageCount: Math.max(0, webPackageCount - skippedWebPackageCount),
  };
};