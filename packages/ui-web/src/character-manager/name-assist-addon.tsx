import type { ReactNode } from 'react';

import type { DataCardFieldPath } from '../card-editor';

import { cardTopName, shouldOfferNameReplace, NAME_REPLACE_NATIVE_MAX_CHARS } from './name-assist';

export interface CharacterManagerNameAssistOptions {
  /** 当前编辑数据（顶层 `codename`/`name` 决定按钮显隐与文案）。 */
  readonly data: Record<string, unknown> | null;
  /** 作为替换基准的原始数据。 */
  readonly originalData: Record<string, unknown> | null;
  /** 顶层 `codename` 字段的「随机」按钮；不提供则不渲染。 */
  readonly onRandomCodename?: () => void;
  /** 「一键替换」按钮回调；不提供则不渲染。 */
  readonly onReplaceAllNames?: () => void;
  /** 按钮下方的说明文字（Web：原生签名提示；Desktop：本机签名语义说明）。 */
  readonly replaceHint?: ReactNode;
  readonly randomButtonClassName?: string;
  readonly replaceButtonClassName?: string;
}

export const DEFAULT_RANDOM_CODENAME_BUTTON_CLASS =
  'ml-2 px-3 py-1.5 text-xs font-semibold text-white bg-pink-500 rounded-lg hover:bg-pink-600';
export const DEFAULT_REPLACE_NAMES_BUTTON_CLASS =
  'text-sm text-white bg-green-500 hover:bg-green-600 rounded-md px-3 py-1 w-full';

export const DEFAULT_NATIVENESS_REPLACE_HINT = (
  <p className="text-xs text-gray-500 mt-1">
    提示：若新基础名称超过 {NAME_REPLACE_NATIVE_MAX_CHARS} 字，替换仍可执行，但会视为“衍生数据”并移除原生签名。
  </p>
);

/**
 * `DataCardFieldEditor.renderFieldAddon` 的名称辅助片段：顶层 `codename` 挂「随机」
 * inline 按钮，名称字段在原/现名称不一致时挂「一键替换」below 按钮。
 * 宿主把它与自身的 addon 合并（如 Web 的敏感词提示）。
 */
export const characterManagerNameFieldAddon = (
  path: DataCardFieldPath,
  options: CharacterManagerNameAssistOptions,
): { inline: ReactNode; below: ReactNode } => {
  const { data, originalData, onRandomCodename, onReplaceAllNames, replaceHint } = options;
  const isNameField = path.length === 1 && (path[0] === 'codename' || path[0] === 'name');
  const showReplace =
    isNameField && onReplaceAllNames !== undefined && shouldOfferNameReplace(originalData, data);

  return {
    inline:
      path.length === 1 && path[0] === 'codename' && onRandomCodename ? (
        <button
          onClick={onRandomCodename}
          type="button"
          className={options.randomButtonClassName ?? DEFAULT_RANDOM_CODENAME_BUTTON_CLASS}
        >
          随机
        </button>
      ) : null,
    below:
      showReplace ? (
        <div className="mt-2">
          <button
            onClick={onReplaceAllNames}
            className={options.replaceButtonClassName ?? DEFAULT_REPLACE_NAMES_BUTTON_CLASS}
          >
            点击将所有“{cardTopName(originalData)}”替换为“{cardTopName(data)}”
          </button>
          {replaceHint}
        </div>
      ) : null,
  };
};
