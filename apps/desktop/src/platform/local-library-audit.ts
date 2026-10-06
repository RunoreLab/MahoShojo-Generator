import {
  DESKTOP_LOCAL_LIBRARY_AUDIT_DAMAGE_KINDS,
  DESKTOP_MAINTENANCE_BUSY_CODE,
  DESKTOP_LOCAL_LIBRARY_AUDIT_KINDS,
  DesktopLocalLibraryAuditErrorSchema,
  DesktopLocalLibraryAuditReportSchema,
  DesktopLocalLibraryGcErrorSchema,
  DesktopLocalLibraryGcReportSchema,
  type DesktopLocalLibraryAuditFinding,
  type DesktopLocalLibraryAuditKind,
  type DesktopLocalLibraryAuditReport,
  type DesktopLocalLibraryGcReport,
} from '@mahoshojo/contracts/desktop-ipc';

/**
 * 审计报告的渲染层桥接（D2.2b）。
 *
 * 这一层只有一件事：把 native 返回的线形 `findings` 变成 UI 可以直接渲染的**按桶分组 + 计数**
 * 结构，并区分"用户可见的损坏"与"可以稍后回收的候选"。
 *
 * 为什么值得单独一层：报告的原始形状是 `findings: Finding[]`，而 UI 要回答三个不同的问题——
 * 需不需要弹警告（损坏）、需不需要提示可以清理（可回收）、每类各有几条。把这三件事散进各个
 * 组件就会各写一遍分组逻辑，而"什么算损坏"这条判断一旦有两份实现就会漂移。
 */

/** 一个桶在 UI 上的呈现形态。 */
export interface LocalLibraryAuditBucket {
  kind: DesktopLocalLibraryAuditKind;
  count: number;
  findings: readonly DesktopLocalLibraryAuditFinding[];
}

export interface LocalLibraryAuditSummary {
  /** 按 `DESKTOP_LOCAL_LIBRARY_AUDIT_KINDS` 的固定顺序排列，缺失的桶不出现。 */
  readonly buckets: readonly LocalLibraryAuditBucket[];
  /** 是否需要向用户报警。false 时 UI 只在"本地库"页展示一个静态的状态说明。 */
  readonly hasDamage: boolean;
  /** 是否存在可以回收的空间（孤儿文件 + purge 后的无引用 metadata）。 */
  readonly hasReclaimableSpace: boolean;
  readonly referencedBlobCount: number;
  readonly blobMetadataCount: number;
  readonly webPackageCount: number;
}

export const AUDIT_LOCAL_LIBRARY_COMMAND = 'audit_local_library' as const;
export const COLLECT_LOCAL_GARBAGE_COMMAND = 'collect_local_garbage' as const;

export interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export class DesktopLocalLibraryAuditError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DesktopLocalLibraryAuditError';
    this.code = code;
  }
}

export class DesktopLocalLibraryGcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DesktopLocalLibraryGcError';
    this.code = code;
  }
}

/**
 * 把报告分组。
 *
 * 顺序取自契约常量而不是"发现出现的顺序"：后者依赖目录遍历顺序，同一份库在两台设备上会
 * 分出不同排列的桶，而用户会以为顺序本身携带了优先级信息。
 *
 * 空报告仍然返回空 `buckets` 而非"每桶一条 count: 0"——UI 需要区分"没有该类问题"与
 * "这一类不存在"，后者靠分母判断。
 */
export const summarizeLocalLibraryAudit = (
  report: DesktopLocalLibraryAuditReport,
): LocalLibraryAuditSummary => {
  const parsed = DesktopLocalLibraryAuditReportSchema.parse(report);
  const byKind = new Map<string, DesktopLocalLibraryAuditFinding[]>();
  for (const finding of parsed.findings) {
    const bucket = byKind.get(finding.kind) ?? [];
    bucket.push(finding);
    byKind.set(finding.kind, bucket);
  }

  const buckets: LocalLibraryAuditBucket[] = [];
  for (const kind of DESKTOP_LOCAL_LIBRARY_AUDIT_KINDS) {
    const findings = byKind.get(kind);
    if (findings === undefined || findings.length === 0) continue;
    buckets.push({ kind, count: findings.length, findings });
  }

  return {
    buckets,
    hasDamage: parsed.findings.some((finding) =>
      (DESKTOP_LOCAL_LIBRARY_AUDIT_DAMAGE_KINDS as readonly string[]).includes(finding.kind),
    ),
    hasReclaimableSpace: buckets.some(
      (bucket) => bucket.kind === 'orphan-file' || bucket.kind === 'unreferenced-metadata',
    ),
    referencedBlobCount: parsed.referencedBlobCount,
    blobMetadataCount: parsed.blobMetadataCount,
    webPackageCount: parsed.webPackageCount,
  };
};

/**
 * 维护冲突重试。
 *
 * `maintenance-busy` 对审计/GC 的含义是「另一个维护窗口正被持有」——`enter_maintenance`
 * 对已在跑的维护（含恢复备份跨 IPC 持有的 pending 许可，以及并发的审计/GC/备份）
 * 立即拒绝而不是排队（`maintenance.rs`）；并发写入则相反，维护者会等它们排空，不会
 * 因此收到 busy。重试不是可有可无的礼貌：用户点"检查本地库"撞上正在等待的恢复或
 * 正在跑的清理时，直接弹错会让他以为操作本身失败了。
 *
 * 退避固定而非指数：维护窗口通常在几百毫秒内结束，而 UI 正在等这个结果——指数退避会把
 * 一个 300ms 的窗口拖成好几秒。
 */
const withMaintenanceRetry = async <T>(
  operation: () => Promise<T>,
  toError: (cause: unknown) => Error,
  attempts: number,
): Promise<T> => {
  const limit = Math.max(1, attempts);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < limit; attempt += 1) {
    try {
      return await operation();
    } catch (cause) {
      lastError = cause;
      if (!isMaintenanceBusy(cause) || attempt === limit - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }

  throw toError(lastError);
};

/** 跑一次审计。 */
export const runLocalLibraryAudit = async (
  invoke: InvokeFn,
  options: { readonly retryOnMaintenance?: number } = {},
): Promise<LocalLibraryAuditSummary> =>
  withMaintenanceRetry(
    async () =>
      summarizeLocalLibraryAudit(
        DesktopLocalLibraryAuditReportSchema.parse(
          (await invoke(AUDIT_LOCAL_LIBRARY_COMMAND)) as DesktopLocalLibraryAuditReport,
        ),
      ),
    toAuditError,
    options.retryOnMaintenance ?? 3,
  );

/**
 * 回收无引用的 blob。
 *
 * 与审计共用维护重试：GC 同样先取维护窗口，撞上另一个在跑的维护时同样被拒。
 */
export const collectLocalLibraryGarbage = async (
  invoke: InvokeFn,
  options: { readonly retryOnMaintenance?: number } = {},
): Promise<DesktopLocalLibraryGcReport> =>
  withMaintenanceRetry(
    async () =>
      DesktopLocalLibraryGcReportSchema.parse(
        (await invoke(COLLECT_LOCAL_GARBAGE_COMMAND)) as DesktopLocalLibraryGcReport,
      ),
    toGcError,
    options.retryOnMaintenance ?? 3,
  );

/**
 * GC 是否真的回收到了东西。
 *
 * 单列这个判断是因为 UI 必须区分两种"零"：`scanned === 0` 说明候选集是空的（库干净，或
 * 用户还没 purge 任何东西）；`scanned > 0 && reclaimed === 0` 说明候选集里有东西却被条件
 * DELETE 挡住了——那值得让用户知道，而不是显示成"没有可回收的空间"。
 */
export const gcReclaimedSomething = (report: DesktopLocalLibraryGcReport): boolean =>
  report.reclaimed > 0;

const isMaintenanceBusy = (cause: unknown): boolean =>
  cause !== null &&
  typeof cause === 'object' &&
  (cause as { code?: unknown }).code === DESKTOP_MAINTENANCE_BUSY_CODE;

const toAuditError = (cause: unknown): DesktopLocalLibraryAuditError => {
  if (
    cause !== null &&
    typeof cause === 'object' &&
    typeof (cause as { code?: unknown }).code === 'string' &&
    typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const parsed = DesktopLocalLibraryAuditErrorSchema.safeParse(cause);
    if (parsed.success) {
      return new DesktopLocalLibraryAuditError(parsed.data.code, parsed.data.message);
    }
  }
  return new DesktopLocalLibraryAuditError('audit-failure', '本地库完整性检查未能完成。');
};

const toGcError = (cause: unknown): DesktopLocalLibraryGcError => {
  if (
    cause !== null &&
    typeof cause === 'object' &&
    typeof (cause as { code?: unknown }).code === 'string' &&
    typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const parsed = DesktopLocalLibraryGcErrorSchema.safeParse(cause);
    if (parsed.success) {
      return new DesktopLocalLibraryGcError(parsed.data.code, parsed.data.message);
    }
  }
  return new DesktopLocalLibraryGcError('gc-failure', '本地库空间清理未能完成。');
};
