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
    uploadMain(file: File): void;
    pasteMain(text: string): void;
    openAuxModal(): void;
    randomMatchAux(): void;
    uploadAux(files: FileList | null): void;
    pasteAux(text: string): void;
    togglePreset(filename: string): void;
    moveAux(fromIndex: number, toIndex: number): void;
    removeAux(key: string): void;
    clearAux(): void;
  }>;
}>;
