import type {
  LocalLibraryArchiveImportPlan,
  LocalLibraryArchiveImportReport,
} from '@mahoshojo/local-library/archive-import';

import type {
  ArchiveExportOutcome,
  ArchiveExportProgress,
  LocalArchiveModel,
} from './contract';

/**
 * 归档界面背后的宿主适配面。
 *
 * 它是共享界面与运行时之间**唯一**的接缝：两端各实现一次，不新增任何 port 或等价接口
 * （`DESK-PROD-003`）。方法刻意都是「永不 reject」——失败通过返回/抛出的约定传给控制器，由控制器写入
 * 对应的错误通道。让 action reject 的话，`void action()` 这种调用形态就会产生未处理的 rejection，
 * 而那正是仓内既有 `web-package-contract.ts` 明确禁止的形状。
 */
export interface LocalArchiveHost {
  /** 读一次存储以判断它是否可用。返回错误文案，或 `null` 表示可用。 */
  readonly probeStorage: () => Promise<string | null>;
  /**
   * 执行导出。
   *
   * `onProgress` 是可选的：Web 侧的打包是同步 `zipSync`，没有中间进度可报，因此它不提供这个回调，
   * 控制器据此呈现不确定态而不是编造百分比。
   */
  readonly runExport: (onProgress?: (progress: ArchiveExportProgress) => void) => Promise<ArchiveExportOutcome>;
  /**
   * 让宿主弹出文件选择器并返回选中的字节。
   *
   * 刻意**不接受路径**：两端都用 `<input type="file">` 与 `File.arrayBuffer()`，不需要任何额外权限，
   * 也不给 renderer 任意路径（`DESK-053`）。用户取消时返回 `null`。
   */
  readonly pickArchiveBytes: () => Promise<Uint8Array | null>;
  /** 完整预检，一次写入都没有。 */
  readonly inspectArchive: (archive: Uint8Array) => Promise<LocalLibraryArchiveImportPlan>;
  /** 按预检结果写入。 */
  readonly applyArchive: (
    archive: Uint8Array,
    plan: LocalLibraryArchiveImportPlan,
  ) => Promise<LocalLibraryArchiveImportReport>;
  /** 把任意失败翻译成用户可读的文案。 */
  readonly describeError: (cause: unknown) => string;
}

export interface LocalArchiveActions {
  readonly startExport: () => void;
  readonly pickImportFile: () => void;
  /** 用户在看完预检摘要之后才被允许调用；没有配对的预检结果时本方法自行早退。 */
  readonly confirmImport: () => void;
  readonly cancelImport: () => void;
  readonly reset: () => void;
  /** 探测存储可用性。页面挂载时调用一次即可，不需要轮询。 */
  readonly probeStorage: () => void;
}

export interface LocalArchiveController {
  readonly model: LocalArchiveModel;
  readonly actions: Readonly<LocalArchiveActions>;
  /** 订阅模型变化。返回注销函数。宿主用它把控制器接进自己的渲染机制。 */
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * 创建一个归档界面控制器。
 *
 * 它是纯状态机：不含 React、不碰存储、不读 `location`。两端各自把它挂进自己的渲染树，因此界面与
 * 流程在两端必然一致，而差异只留在 {@link LocalArchiveHost} 的六个方法里。
 *
 * 它**不**接收长度上限：上限只用于界面展示与宿主侧的提前判定，而这两件事都属于视图与 adapter。把它
 * 作为参数收进来却不用，会让「控制器知道预算」这个错觉看起来像一种保护。
 */
export const createLocalArchiveController = (host: LocalArchiveHost): LocalArchiveController => {
  let model: LocalArchiveModel = {
    storageError: null,
    exporting: false,
    exportProgress: null,
    exportError: null,
    lastExport: null,
    inspecting: false,
    importError: null,
    plan: null,
    applying: false,
    report: null,
  };

  // 保留最近一次预检的字节：`apply` 必须拿到 `inspect` 返回的**那一份** plan，而 plan 依赖它所校验的
  // 同一段字节。把它存在闭包里而不是让 UI 回传，正是为了杜绝"预检 A、按 B 写入"这种错配。
  let inspectedArchive: Uint8Array | null = null;
  let inspectedPlan: LocalLibraryArchiveImportPlan | null = null;

  const listeners = new Set<() => void>();
  // 同一控制器一次只运行一个归档操作；同步置位，避免快速点击在重渲染前绕过按钮禁用态。
  const isBusy = (): boolean => model.exporting || model.inspecting || model.applying;
  const setModel = (next: Partial<LocalArchiveModel>): void => {
    model = { ...model, ...next };
    for (const listener of listeners) listener();
  };

  const probeStorage = async (): Promise<void> => {
    try {
      const error = await host.probeStorage();
      setModel({ storageError: error });
    } catch (cause) {
      setModel({ storageError: host.describeError(cause) });
    }
  };

  const startExport = async (): Promise<void> => {
    if (isBusy()) return;
    setModel({ exporting: true, exportError: null, exportProgress: { kind: 'indeterminate' } });
    try {
      const outcome = await host.runExport((progress) => setModel({ exportProgress: progress }));
      // 只有宿主返回了结果才写 `lastExport`。成功与否完全由宿主判定——D2.3d 的门禁要求导出结果
      // 只以 native 最终完成确认为准，界面不参与这个判断。
      setModel({ exporting: false, exportProgress: null, lastExport: outcome, exportError: null });
    } catch (cause) {
      setModel({ exporting: false, exportProgress: null, exportError: host.describeError(cause) });
    }
  };

  const pickImportFile = async (): Promise<void> => {
    if (isBusy()) return;
    setModel({ inspecting: true, importError: null });
    try {
      const archive = await host.pickArchiveBytes();
      if (archive === null) {
        // 用户取消不是错误。清掉 inspecting 即可，不写任何错误通道——否则"我点错了"会被显示成故障。
        setModel({ inspecting: false });
        return;
      }

      const plan = await host.inspectArchive(archive);
      inspectedArchive = archive;
      inspectedPlan = plan;
      setModel({ inspecting: false, plan, report: null, importError: null });
    } catch (cause) {
      // 预检失败必须清掉上一份 plan：留着它会让用户点"确认导入"时按一份**与当前文件无关**的
      // 预检结果写入，这是最危险的一种状态。
      inspectedArchive = null;
      inspectedPlan = null;
      setModel({ inspecting: false, plan: null, report: null, importError: host.describeError(cause) });
    }
  };

  const confirmImport = async (): Promise<void> => {
    if (isBusy()) return;
    // 没有预检结果就没有"确认"。这条早退让 UI 不必自己判断能不能点，也保证 apply 永远拿得到配对的
    // 字节与 plan。
    if (inspectedArchive === null || inspectedPlan === null) return;

    setModel({ applying: true, importError: null });
    try {
      const report = await host.applyArchive(inspectedArchive, inspectedPlan);
      setModel({ applying: false, report, importError: null });
    } catch (cause) {
      setModel({ applying: false, importError: host.describeError(cause) });
    }
  };

  const cancelImport = (): void => {
    if (isBusy()) return;
    inspectedArchive = null;
    inspectedPlan = null;
    setModel({ plan: null, report: null, importError: null, applying: false, inspecting: false });
  };

  const reset = (): void => {
    if (isBusy()) return;
    cancelImport();
    setModel({ lastExport: null, exportError: null, exportProgress: null });
  };

  return {
    get model() {
      return model;
    },
    actions: {
      startExport: () => {
        void startExport();
      },
      pickImportFile: () => {
        void pickImportFile();
      },
      confirmImport: () => {
        void confirmImport();
      },
      cancelImport,
      reset,
      probeStorage: () => {
        void probeStorage();
      },
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
