import type { ScenarioPreset } from '@/lib/scenario-presets';

/**
 * 共享情景区块的 UI contract。
 * 状态容器（单人 battle store / proposal editor session）由各自 adapter 持有；
 * 共享视图只消费归一化 model，不 import store、Room controller 或网络 client。
 */

export type ArenaScenarioAuxView = Readonly<{
  key: string;
  title: string;
  isNative: boolean;
}>;

export type ArenaScenarioSectionCapabilities = Readonly<{
  browseMain: boolean;
  randomMatchMain: boolean;
  clearMain: boolean;
  uploadMain: boolean;
  pasteMain: boolean;
  /** 预设情景选择块（solo 为服务器目录，proposal 为房间策展目录）。 */
  presetRefs: boolean;
  /** 辅助情景区块是否可见。 */
  auxSection: boolean;
  /** 当前是否允许新增辅助情景（含主情景门槛与参考项预算判断后的结果）。 */
  addAux: boolean;
  browseAux: boolean;
  randomMatchAux: boolean;
  uploadAux: boolean;
  pasteAux: boolean;
  reorderAux: boolean;
  removeAux: boolean;
  clearAux: boolean;
}>;

export type ArenaScenarioSectionModel = Readonly<{
  disabled: boolean;
  /** 仅驱动共享主情景入口的“登录后可访问私有数据卡”提示（solo 语义）。
   *  proposal 恒为 true：编辑者必已登录，私有卡被提案安全边界禁止、与登录态无关。 */
  isAuthenticated: boolean;
  isMatchingBlocked: boolean;
  isMatchingScenario: boolean;
  /** 主情景展示名；null 表示未选择。 */
  mainName: string | null;
  mainIsNative: boolean;
  auxScenarios: readonly ArenaScenarioAuxView[];
  /** solo 参考项预算行，如 “参考项合计 2/6”；null 不展示。 */
  auxBudgetLine: string | null;
  /** 参考项预算是否已用尽（展示警示）。 */
  auxBudgetExhausted: boolean;
  presets: readonly ScenarioPreset[];
  presetsLoading: boolean;
  presetsError: string | null;
  selectedPresetFilenames: readonly string[];
  loadingPresetFilename: string | null;
  capabilities: ArenaScenarioSectionCapabilities;
  actions: Readonly<{
    openMainModal(): void;
    randomMatchMain(): void;
    clearMain(): void;
    /** 上传/粘贴必须在 Promise 中反映真实成败：失败时 adapter 呈现错误并 reject，
     *  共享视图据此保留用户输入，避免失败仍清空（ScenarioPickerPanel 既有语义）。 */
    uploadMain(file: File): Promise<void>;
    pasteMain(text: string): Promise<void>;
    openAuxModal(): void;
    randomMatchAux(): void;
    uploadAux(files: FileList | null): Promise<void>;
    pasteAux(text: string): Promise<void>;
    togglePreset(filename: string): void;
    moveAux(fromIndex: number, toIndex: number): void;
    removeAux(key: string): void;
    clearAux(): void;
  }>;
}>;
