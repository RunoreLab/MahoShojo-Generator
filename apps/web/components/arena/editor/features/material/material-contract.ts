/**
 * 共享素材区块的 UI contract。
 * 状态容器（单人 battle store / proposal editor session）由各自 adapter 持有；
 * 共享视图只消费归一化 model，不 import store、Room controller 或网络 client。
 */

export type ArenaMaterialItemView = Readonly<{
  key: string;
  name: string;
  sourceLabel: string;
  fileName?: string | null;
}>;

export type ArenaMaterialSectionCapabilities = Readonly<{
  browseOnline: boolean;
  clearAll: boolean;
  upload: boolean;
  paste: boolean;
  reorder: boolean;
}>;

export type ArenaMaterialSectionModel = Readonly<{
  disabled: boolean;
  items: readonly ArenaMaterialItemView[];
  /** 统计行（solo 含参考项预算）；缺省时视图展示 “已选素材 N”。 */
  statsLine?: string | null;
  /** 区块级说明（如 proposal 素材目录限制）。 */
  notice?: string | null;
  /** 浏览/上传/粘贴入口的容量门槛（solo 与 proposal 均投影参考项联合预算）。 */
  hasReferenceCapacity: boolean;
  capabilities: ArenaMaterialSectionCapabilities;
  actions: Readonly<{
    openModal(): void;
    clearAll(): void;
    /** 上传/粘贴必须在 Promise 中反映真实成败：失败时 adapter 呈现错误并 reject，
     *  共享视图据此保留用户输入，避免失败仍清空（旧 MaterialPanel 语义）。 */
    upload(files: FileList | null): Promise<void>;
    paste(text: string): Promise<void>;
    move(fromIndex: number, toIndex: number): void;
    remove(key: string): void;
  }>;
}>;
