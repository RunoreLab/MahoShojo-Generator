import {
  DESKTOP_CONFIG_DEFAULTS,
  parseDesktopConfigText,
  serializeDesktopConfig,
  type DesktopConfigDiagnostic,
  type DesktopConfigDocumentExtras,
  type DesktopConfigValues,
} from '@mahoshojo/contracts/desktop-config';
import type { DesktopConfigFileState } from '@mahoshojo/contracts/desktop-ipc';

import {
  DesktopConfigError,
  openDesktopConfigDirectory,
  readDesktopConfig,
  writeDesktopConfig,
  type InvokeFn,
} from '../../platform/config-bridge';

/**
 * Desktop 人工配置的进程内事实源（D5.1-S2，`DESK-SET-004`/`005`）。
 *
 * native 的三条窄命令决定「文件在不在、字节是什么、能不能安全替换」；
 * `contracts/desktop-config` 决定「字段是什么、默认是什么、坏了怎么降级」。
 * 本 store 只做编排：读一次 → 生效值 + 诊断投影给消费者；写整份 → 携带
 * 读取时的 content revision，冲突时自动重载磁盘真相而不是覆盖。
 *
 * 「生效值」与「落盘值」严格同一：写失败不把内存值冒充已保存——成功后
 * `base` 才前进。连续编辑合并基于 `pending ?? inFlight ?? base`，IPC 在途
 * 期间的修改不会被旧 base 吞掉；冲突时未落盘编辑按「触碰字段 → 试图值」
 * 收拢为草稿（`conflictedFields` 投影），磁盘版本成为 effective，草稿
 * 不自动重放，由用户选择重新应用或放弃；草稿只随写确认核销——重新应用
 * 途中普通失败不丢草稿。
 */

export interface DesktopConfigState {
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable';
  /** native 回显的 `config.json` 绝对路径与所在目录（展示用）。 */
  readonly path: string | null;
  readonly directory: string | null;
  /** 上次有效文件 `.bak` 是否存在（恢复路径提示）。 */
  readonly backupPresent: boolean;
  readonly fileStatus: 'unknown' | DesktopConfigFileState['status'];
  /** `ok` 文件但域解析 fatal（JSON/顶层形态/version 非 1）。 */
  readonly fileFatal: boolean;
  readonly values: DesktopConfigValues;
  readonly diagnostics: readonly DesktopConfigDiagnostic[];
  /** IPC 级读取失败（区别于文件状态异常）。 */
  readonly readError: string | null;
  /** 最近一次写入失败/冲突的用户可读说明。 */
  readonly saveError: string | null;
  /**
   * 冲突草稿中的字段名（`conflictedDraft` 的纯投影）。这些字段的磁盘版本
   * 已生效；草稿可显式重新应用或放弃，不自动重放（DESK-SET-005「保留双方」）。
   */
  readonly conflictedFields: readonly (keyof DesktopConfigValues)[] | null;
  readonly saving: boolean;
}

const INITIAL_STATE: DesktopConfigState = {
  status: 'idle',
  path: null,
  directory: null,
  backupPresent: false,
  fileStatus: 'unknown',
  fileFatal: false,
  values: DESKTOP_CONFIG_DEFAULTS,
  diagnostics: [],
  readError: null,
  saveError: null,
  conflictedFields: null,
  saving: false,
};

const EMPTY_EXTRAS: DesktopConfigDocumentExtras = {
  topLevel: {},
  announcements: {},
  externalLinks: {},
};

interface ConfirmedBase {
  /** 最后一次与磁盘一致的内容 revision；`null` = 文件不存在。 */
  readonly revision: string | null;
  readonly values: DesktopConfigValues;
  readonly extras: DesktopConfigDocumentExtras;
}

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : '配置文件操作失败';

/**
 * 一笔待落盘写：整份目标值 + 用户显式触碰过的字段集合。
 *
 * `touched` 记的是**用户意图**而不是值 diff——字段被改回旧 base 值
 * （含「恢复默认」落在已是默认的文件上）仍是有效意图；冲突草稿按
 * touched 收拢，值碰巧等于旧 base 照样进草稿，不会出现「有报错却
 * 没草稿」的空投影。
 */
interface WriteIntent {
  readonly values: DesktopConfigValues;
  readonly touched: ReadonlySet<keyof DesktopConfigValues>;
}

export class DesktopConfigStore {
  private state: DesktopConfigState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly deps: { readonly invoke: InvokeFn };

  /** 与磁盘一致的最近基底（revision + 生效值 + 未登记键）。 */
  private base: ConfirmedBase = {
    revision: null,
    values: DESKTOP_CONFIG_DEFAULTS,
    extras: EMPTY_EXTRAS,
  };
  /** 已合并但尚未落盘的编辑意图；冲突时按 touched 收拢为草稿。 */
  private pending: WriteIntent | null = null;
  /**
   * 已取出 `pending`、IPC 在途但尚未确认的写意图。新编辑合并基于
   * `pending ?? inFlight ?? base`——没有它，写 1 在途时的写 2 会从旧
   * `base` 重建，把写 1 的改动静默吞掉（lost update）。
   */
  private inFlight: WriteIntent | null = null;
  /**
   * 冲突时未落盘的「触碰字段 → 试图值」草稿。不生效、不自动重放；
   * 只随写确认核销（落盘字段移出草稿）或显式放弃/恢复默认，普通写
   * 失败不丢。用户可经 `reapplyConflictedDraft`/`discardConflictedDraft`
   * 处置。
   */
  private conflictedDraft: Partial<DesktopConfigValues> | null = null;
  /** 读/写串行队列——revision 语义要求「读-改-写」不交错。 */
  private chain: Promise<void> = Promise.resolve();
  private firstLoad: Promise<void> | null = null;

  constructor(deps: { readonly invoke: InvokeFn }) {
    this.deps = deps;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): DesktopConfigState => this.state;

  private publish(next: Partial<Omit<DesktopConfigState, 'conflictedFields'>>): void {
    this.state = {
      ...this.state,
      ...next,
      // `conflictedFields` 是 `conflictedDraft` 的纯投影：草稿存在性只有
      // 一个事实源，每次发布重新推导，投影不会和草稿脱节。
      conflictedFields: this.draftFieldList(),
    };
    for (const listener of this.listeners) listener();
  }

  private draftFieldList(): readonly (keyof DesktopConfigValues)[] | null {
    const draft = this.conflictedDraft;
    if (draft === null) return null;
    const keys = Object.keys(draft) as (keyof DesktopConfigValues)[];
    return keys.length > 0 ? keys : null;
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(op).catch(() => undefined);
    return this.chain;
  }

  /**
   * 首次读取（幂等）：只在第一次调用时真正发 `desktop_config_read`。
   * 永远不 reject——读取失败同样以 `unavailable` 投影 + 默认值收口，
   * 消费者（公告策略、外链确认）按各自的降级规则继续工作。
   */
  ready(): Promise<void> {
    this.firstLoad ??= this.enqueue(() => this.doLoad());
    return this.firstLoad;
  }

  /** 显式重载：设置页「重新加载」按钮的唯一入口，与首读同一条路径。 */
  reload(): Promise<void> {
    return this.enqueue(() => this.doLoad());
  }

  /** 当前是否允许编辑写回（文件可作为编辑基底）。 */
  editable(): boolean {
    return (
      this.state.status === 'ready'
      && !this.state.fileFatal
      && (this.state.fileStatus === 'ok' || this.state.fileStatus === 'missing')
    );
  }

  private async doLoad(): Promise<void> {
    this.publish({ status: 'loading' });
    let result;
    try {
      result = await readDesktopConfig(this.deps.invoke);
    } catch (cause) {
      this.base = { revision: null, values: DESKTOP_CONFIG_DEFAULTS, extras: EMPTY_EXTRAS };
      this.pending = null;
      this.publish({
        status: 'unavailable',
        path: null,
        directory: null,
        backupPresent: false,
        fileStatus: 'unknown',
        fileFatal: false,
        values: DESKTOP_CONFIG_DEFAULTS,
        diagnostics: [],
        readError: describeCause(cause),
        saveError: null,
      });
      return;
    }

    const shared = {
      status: 'ready' as const,
      path: result.path,
      directory: result.directory,
      backupPresent: result.backupPresent,
      readError: null,
      // 重载成功即清掉陈旧写入错误——错误描述的是上一次写，不是当前文件。
      saveError: null,
    };

    switch (result.file.status) {
      case 'missing':
        this.base = { revision: null, values: DESKTOP_CONFIG_DEFAULTS, extras: EMPTY_EXTRAS };
        this.publish({
          ...shared,
          fileStatus: 'missing',
          fileFatal: false,
          values: DESKTOP_CONFIG_DEFAULTS,
          diagnostics: [],
        });
        return;
      case 'oversized':
        this.base = { revision: result.file.revision, values: DESKTOP_CONFIG_DEFAULTS, extras: EMPTY_EXTRAS };
        this.publish({
          ...shared,
          fileStatus: 'oversized',
          fileFatal: true,
          values: DESKTOP_CONFIG_DEFAULTS,
          diagnostics: [
            {
              path: '$',
              message: `配置文件超过大小上限（${result.file.bytes} 字节），已按默认值生效；可在修复文件或恢复默认后重载`,
            },
          ],
        });
        return;
      case 'invalid-utf8':
        this.base = { revision: result.file.revision, values: DESKTOP_CONFIG_DEFAULTS, extras: EMPTY_EXTRAS };
        this.publish({
          ...shared,
          fileStatus: 'invalid-utf8',
          fileFatal: true,
          values: DESKTOP_CONFIG_DEFAULTS,
          diagnostics: [
            { path: '$', message: '配置文件不是合法的 UTF-8 文本，已按默认值生效' },
          ],
        });
        return;
      case 'ok': {
        const parsed = parseDesktopConfigText(result.file.content);
        this.base = {
          revision: result.file.revision,
          values: parsed.values,
          extras: parsed.extras,
        };
        this.publish({
          ...shared,
          fileStatus: 'ok',
          fileFatal: parsed.fatal,
          values: parsed.values,
          diagnostics: parsed.diagnostics,
        });
        return;
      }
    }
  }

  /** 设置页字段写：合并到 pending 后排队落盘；不可编辑时静默忽略（UI 已禁用）。 */
  setField<K extends keyof DesktopConfigValues>(key: K, value: DesktopConfigValues[K]): void {
    if (!this.editable()) return;
    const prior = this.pending ?? this.inFlight;
    const touched = new Set(prior?.touched ?? []);
    touched.add(key);
    this.pending = {
      values: { ...(prior?.values ?? this.base.values), [key]: value },
      touched,
    };
    this.publish({ saving: true, saveError: null });
    void this.enqueue(() => this.consumePendingWrite());
  }

  /**
   * 把 `pending` 取为在途写目标并落盘。取走后 `inFlight` 继续充当后续
   * 编辑的合并基底，直到 `tryWrite` 收口。
   */
  private async consumePendingWrite(): Promise<void> {
    const target = this.pending;
    if (target === null) return;
    this.pending = null;
    await this.tryWrite(target);
  }

  /**
   * 显式恢复默认：携带当前真实 revision 写 `{version:1, 默认值}`。
   * 这是用户在诊断页明确选择的动作——不是异常路径上的静默覆盖；原文件
   * 由 native `.bak`（有效文件）或 `.invalid`（无效文件隔离位）保留。
   * 全部登记字段都计入 touched：默认值碰巧等于当前 base 时，冲突草稿
   * 仍如实记录这次显式恢复意图，而不是得出空草稿。
   */
  resetToDefaults(): void {
    if (this.state.status !== 'ready' || this.state.fileStatus === 'missing') return;
    this.pending = null;
    this.conflictedDraft = null;
    this.publish({ saving: true, saveError: null });
    void this.enqueue(() =>
      this.tryWrite(
        {
          values: DESKTOP_CONFIG_DEFAULTS,
          touched: new Set(
            Object.keys(DESKTOP_CONFIG_DEFAULTS) as (keyof DesktopConfigValues)[],
          ),
        },
        EMPTY_EXTRAS,
      ),
    );
  }

  /**
   * 冲突草稿：重新应用——草稿合到当前磁盘基底上，未触碰字段保持
   * 外部版本不回滚；走与 `setField` 相同的 pending→落盘路径。
   * 草稿不在此处销毁：落盘成功才核销，普通失败原样保留，再次冲突
   * 由 conflict 路径按 touched 重新收拢。
   */
  reapplyConflictedDraft(): void {
    const draft = this.conflictedDraft;
    if (draft === null || !this.editable()) return;
    const prior = this.pending ?? this.inFlight;
    const touched = new Set(prior?.touched ?? []);
    for (const key of Object.keys(draft) as (keyof DesktopConfigValues)[]) touched.add(key);
    this.pending = {
      values: { ...(prior?.values ?? this.base.values), ...draft } as DesktopConfigValues,
      touched,
    };
    this.publish({ saving: true, saveError: null });
    void this.enqueue(() => this.consumePendingWrite());
  }

  /** 冲突草稿：放弃——磁盘版本保持生效，草稿销毁。 */
  discardConflictedDraft(): void {
    if (this.conflictedDraft === null) return;
    this.conflictedDraft = null;
    // 一并清掉「已保留为草稿」的旧 saveError——草稿都没了，那句话不再是真的。
    this.publish({ saveError: null });
  }

  private async tryWrite(
    intent: WriteIntent,
    extras?: DesktopConfigDocumentExtras,
  ): Promise<void> {
    this.inFlight = intent;
    // 在途期间如实保持 saving——上一笔写的 settle 可能已把它拨回 false，
    // 而本笔 IPC 才刚刚开始。
    this.publish({ saving: true });
    const effectiveExtras = extras ?? this.base.extras;
    const content = serializeDesktopConfig(intent.values, effectiveExtras);
    try {
      const result = await writeDesktopConfig(this.deps.invoke, {
        expectedRevision: this.base.revision,
        content,
      });
      this.base = { revision: result.revision, values: intent.values, extras: effectiveExtras };
      // 草稿随写确认核销：本笔真正落盘的触碰字段移出草稿——reapply 的
      // touched 覆盖全部草稿键，等价整体核销；只命中部分字段的普通写
      // 留下剩余草稿，不丢未落盘意图。
      if (this.conflictedDraft !== null) {
        const remaining = { ...this.conflictedDraft };
        for (const key of intent.touched) delete remaining[key];
        this.conflictedDraft = Object.keys(remaining).length > 0 ? remaining : null;
      }
      // 写回内容再经同一解析——未登记键的诊断如实保留，不让 UI 保存
      // 伪装成「配置文件完全干净」。
      const reparsed = parseDesktopConfigText(content);
      this.publish({
        status: 'ready',
        fileStatus: 'ok',
        fileFatal: false,
        values: intent.values,
        diagnostics: reparsed.diagnostics,
        saveError: null,
        // 队列里还有下一笔时不出「空闲」假象。
        saving: this.pending !== null,
        // `.bak` 只在「替换掉一份信封有效文件」时产生：fatal/invalid-utf8/
        // oversized 走 `.invalid` 隔离不新建 .bak，missing 首写也没有
        // 旧文件可备份——按写入前的文件形态投影，与 native 口径一致。
        backupPresent:
          this.state.backupPresent
          || (this.state.fileStatus === 'ok' && !this.state.fileFatal),
      });
    } catch (cause) {
      if (cause instanceof DesktopConfigError && cause.code === 'config-conflict') {
        // 磁盘真相优先：未落盘编辑（pending 若已生成则含本次在途修改，
        // 其 touched 累计覆盖在途写）按「触碰字段 → 试图值」收拢进草稿
        // ——记用户意图不拿值 diff 反推；不生效、不自动重放。
        const attempted = this.pending ?? intent;
        const draft: Partial<DesktopConfigValues> = { ...this.conflictedDraft };
        const record = <K extends keyof DesktopConfigValues>(key: K): void => {
          draft[key] = attempted.values[key];
        };
        for (const key of attempted.touched) record(key);
        this.conflictedDraft = draft;
        this.pending = null;
        // 被拒绝的试图值不再充当合并基底：重载窗口里的新编辑从旧 base
        // 合并，而不是把刚冲突掉的内容偷偷带回 pending。
        this.inFlight = null;
        // doLoad 清陈旧 saveError 并把 base 推进到磁盘真相；冲突提示在
        // 其后投影，避免被 reload 的清错语义吞掉。
        await this.doLoad();
        this.publish({
          saving: false,
          saveError:
            '配置文件已在应用外被修改，刚才的修改未写入；已保留为草稿，可基于最新内容重新应用或放弃',
        });
        return;
      }
      this.publish({
        saving: this.pending !== null,
        saveError: describeCause(cause),
      });
    } finally {
      this.inFlight = null;
    }
  }

  /** 打开配置目录；失败经 saveError 投影而不是吞掉。 */
  async openDirectory(): Promise<void> {
    try {
      await openDesktopConfigDirectory(this.deps.invoke);
    } catch (cause) {
      this.publish({ saveError: describeCause(cause) });
    }
  }
}
