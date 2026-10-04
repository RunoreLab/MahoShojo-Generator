import type { ReactNode } from 'react';

import {
  DATA_CARD_NAME_MAX_LENGTH,
  formatDataCardFieldLabel,
  isEditableRecord,
  isHiddenDataCardField,
  orderDataCardFieldKeys,
  toDataCardFieldId,
} from './field-rules';

/** 宿主为单个字段注入的附件。路径为点分完整路径，例如 `appearance.outfit`。 */
export interface DataCardFieldAddon {
  /** 标记该字段有问题（例如敏感词命中），输入框改用 `invalidInput` 样式。 */
  readonly invalid?: boolean;
  /** 紧跟单行/短文本输入框的行内附件（例如“随机”按钮）。 */
  readonly inline?: ReactNode;
  /** 字段下方的附件（例如提示或批量替换按钮）。 */
  readonly below?: ReactNode;
}

export interface DataCardFieldEditorClasses {
  readonly input: string;
  readonly invalidInput: string;
  readonly readonlyInput: string;
  readonly label: string;
  readonly fieldset: string;
  readonly legend: string;
  readonly hint: string;
}

/** 默认样式只用共源 `--app-*` 令牌；Web 角色管理注入它既有的全局类以保持原外观。 */
export const DEFAULT_DATA_CARD_FIELD_EDITOR_CLASSES: DataCardFieldEditorClasses = {
  input: 'w-full min-h-11 rounded-lg border border-(--app-border-strong) bg-transparent px-3 py-2 text-sm',
  invalidInput: 'w-full min-h-11 rounded-lg border border-(--app-accent-strong) bg-transparent px-3 py-2 text-sm',
  readonlyInput: 'w-full rounded-lg border border-(--app-border) bg-(--app-surface-90) px-3 py-2 text-xs cursor-not-allowed',
  label: 'block text-sm font-medium capitalize',
  fieldset: 'mt-4 rounded-lg border border-(--app-border) p-4',
  legend: 'px-2 text-sm font-semibold capitalize text-(--app-text-muted)',
  hint: 'mt-1 text-xs text-(--app-text-muted)',
};

export interface DataCardFieldEditorProps {
  readonly data: Record<string, unknown>;
  readonly onFieldChange: (path: string, value: unknown) => void;
  readonly classes?: Partial<DataCardFieldEditorClasses>;
  readonly renderFieldAddon?: (path: string) => DataCardFieldAddon | null;
}

/** 字段编辑不是凭据输入：阻止浏览器与密码管理器把它当成登录表单自动填充。 */
const NON_CREDENTIAL_INPUT_PROPS = {
  name: 'maho-editor-field',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-form-type': 'other',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-bwignore': 'true',
} as const;

/**
 * 共源递归数据卡字段编辑器。
 *
 * 字符串数组按行编辑，其他数组只读展示 JSON（避免破坏结构），对象递归为分组，`content` 用大文本框，
 * 长字符串用多行框；隐藏字段与顺序见 `field-rules`。所有写入通过 `onFieldChange(path, value)` 交给宿主，
 * 组件自身不持有数据副本。
 */
export const DataCardFieldEditor = ({ data, onFieldChange, classes, renderFieldAddon }: DataCardFieldEditorProps) => {
  const css = { ...DEFAULT_DATA_CARD_FIELD_EDITOR_CLASSES, ...classes };

  const renderFields = (record: Record<string, unknown>, path: string): ReactNode =>
    orderDataCardFieldKeys(Object.keys(record)).map((key) => {
      if (isHiddenDataCardField(key)) return null;
      const currentPath = path ? `${path}.${key}` : key;
      const fieldId = toDataCardFieldId(currentPath);
      const value = record[key];
      const addon = renderFieldAddon?.(currentPath) ?? null;
      const inputClassName = addon?.invalid ? css.invalidInput : css.input;
      const label = formatDataCardFieldLabel(key);

      if (Array.isArray(value)) {
        if (value.every((item) => typeof item === 'string')) {
          return (
            <div key={currentPath} className="mt-4">
              <label htmlFor={fieldId} className={css.label}>{label}</label>
              <textarea
                id={fieldId}
                value={(value as string[]).join('\n')}
                onChange={(event) => onFieldChange(currentPath, event.target.value.split('\n'))}
                rows={Math.max(3, value.length)}
                className={inputClassName}
                placeholder="每行输入一个项目"
                {...NON_CREDENTIAL_INPUT_PROPS}
              />
              <p className={css.hint}>此字段为列表，请每行输入一个项目。</p>
              {addon?.below}
            </div>
          );
        }
        return (
          <div key={currentPath} className="mt-4">
            <label htmlFor={fieldId} className={css.label}>{label} (只读)</label>
            <textarea id={fieldId} value={JSON.stringify(value, null, 2)} readOnly rows={5} className={css.readonlyInput} />
          </div>
        );
      }

      if (isEditableRecord(value)) {
        return (
          <fieldset key={currentPath} className={css.fieldset}>
            <legend className={css.legend}>{label}</legend>
            <div className="space-y-4">{renderFields(value, currentPath)}</div>
          </fieldset>
        );
      }

      if (typeof value === 'string' && currentPath === 'content') {
        const lineCount = Math.max(1, value.split(/\r?\n/).length);
        return (
          <div key={currentPath}>
            <label htmlFor={fieldId} className={css.label}>{label}</label>
            <textarea
              id={fieldId}
              value={value}
              onChange={(event) => onFieldChange(currentPath, event.target.value)}
              rows={Math.min(30, Math.max(10, lineCount + 2))}
              className={inputClassName}
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word' }}
              wrap="soft"
              {...NON_CREDENTIAL_INPUT_PROPS}
            />
            {addon?.below}
          </div>
        );
      }

      return (
        <div key={currentPath}>
          <label htmlFor={fieldId} className={css.label}>{label}</label>
          <div className="mt-1 flex items-center">
            {typeof value === 'string' && value.length > 80 ? (
              <textarea
                id={fieldId}
                value={value}
                onChange={(event) => onFieldChange(currentPath, event.target.value)}
                rows={3}
                className={inputClassName}
                {...NON_CREDENTIAL_INPUT_PROPS}
              />
            ) : (
              <input
                type="text"
                id={fieldId}
                value={value === null || value === undefined ? '' : String(value)}
                onChange={(event) => onFieldChange(currentPath, event.target.value)}
                className={inputClassName}
                maxLength={key === 'codename' || key === 'name' ? DATA_CARD_NAME_MAX_LENGTH : undefined}
                {...NON_CREDENTIAL_INPUT_PROPS}
              />
            )}
            {addon?.inline}
          </div>
          {addon?.below}
        </div>
      );
    });

  return <>{renderFields(data, '')}</>;
};
