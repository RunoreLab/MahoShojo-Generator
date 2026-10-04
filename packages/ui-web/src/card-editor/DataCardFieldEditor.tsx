import { useEffect, useState, type ReactNode } from 'react';

import {
  DATA_CARD_NAME_MAX_LENGTH,
  formatDataCardFieldLabel,
  isEditableRecord,
  isHiddenDataCardField,
  orderDataCardFieldKeys,
  toDataCardFieldId,
  type DataCardFieldPath,
} from './field-rules';

/**
 * 宿主为单个字段注入的附件。`path` 是 `.` 连接的展示路径（例如 `appearance.outfit`）：
 * 键本身含 `.` 时该串有歧义，但它只用于展示匹配（敏感词、随机按钮），不参与写入。
 */
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
  /** 路径为逐段键名（`DataCardFieldPath`），不是点分字符串；写入侧不做 `split('.')` 解释。 */
  readonly onFieldChange: (path: DataCardFieldPath, value: unknown) => void;
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

interface DataCardNumberInputProps {
  readonly id: string;
  readonly value: number;
  readonly onCommit: (value: number) => void;
  readonly className: string;
}

/**
 * number 字段输入：本地保留文本草稿，`''`、`'-'`、`'1e'` 这类输入中间态不提交；
 * 提交给宿主的永远是有限 number，而不是 `event.target.value` 字符串。
 */
const DataCardNumberInput = ({ id, value, onCommit, className }: DataCardNumberInputProps) => {
  const [text, setText] = useState(() => String(value));
  useEffect(() => {
    // 外部值变化（换卡、宿主重置草稿）时刷新；`Number(current) === value` 说明本地文本
    // 就是当前值的另一种写法（如 '4.' / '04'），保留它以免打断输入。
    setText((current) => (current.trim() !== '' && Number(current) === value ? current : String(value)));
  }, [value]);
  return (
    <input
      type="number"
      id={id}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next.trim() === '') return;
        const parsed = Number(next);
        if (Number.isFinite(parsed)) onCommit(parsed);
      }}
      onBlur={() => setText(String(value))}
      className={className}
      step="any"
      {...NON_CREDENTIAL_INPUT_PROPS}
    />
  );
};

/** null 与其他无法猜测目标类型的值不猜用户意图，只读展示。 */
const readonlyPrimitiveText = (value: unknown): string => String(value);

/**
 * 共源递归数据卡字段编辑器。
 *
 * 字符串数组按行编辑，其他数组只读展示 JSON（避免破坏结构），对象递归为分组，`content` 用大文本框，
 * 长字符串用多行框；number / boolean 类型感知编辑，null 与其余非可编辑值只读——`onFieldChange`
 * 交回的值保持原 JSON 类型，不把 number/boolean 静默写成 string。隐藏字段与顺序见 `field-rules`。
 * 所有写入通过 `onFieldChange(path, value)` 交给宿主，组件自身不持有数据副本。
 */
export const DataCardFieldEditor = ({ data, onFieldChange, classes, renderFieldAddon }: DataCardFieldEditorProps) => {
  const css = { ...DEFAULT_DATA_CARD_FIELD_EDITOR_CLASSES, ...classes };

  const renderFields = (record: Record<string, unknown>, path: DataCardFieldPath): ReactNode =>
    orderDataCardFieldKeys(Object.keys(record)).map((key) => {
      if (isHiddenDataCardField(key)) return null;
      const segments = [...path, key];
      // `displayPath` 只用于展示与 DOM id（键含 `.` 时可能与嵌套路径撞串，属可接受的展示歧义）；
      // React key 用无歧义编码，保证 `{ "a.b": 1, "a": { "b": 2 } }` 这种数据不产生重复 key。
      const displayPath = segments.join('.');
      const reactKey = JSON.stringify(segments);
      const fieldId = toDataCardFieldId(displayPath);
      const value = record[key];
      const addon = renderFieldAddon?.(displayPath) ?? null;
      const inputClassName = addon?.invalid ? css.invalidInput : css.input;
      const label = formatDataCardFieldLabel(key);

      if (Array.isArray(value)) {
        if (value.every((item) => typeof item === 'string')) {
          return (
            <div key={reactKey} className="mt-4">
              <label htmlFor={fieldId} className={css.label}>{label}</label>
              <textarea
                id={fieldId}
                value={(value as string[]).join('\n')}
                onChange={(event) => onFieldChange(segments, event.target.value.split('\n'))}
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
          <div key={reactKey} className="mt-4">
            <label htmlFor={fieldId} className={css.label}>{label} (只读)</label>
            <textarea id={fieldId} value={JSON.stringify(value, null, 2)} readOnly rows={5} className={css.readonlyInput} />
          </div>
        );
      }

      if (isEditableRecord(value)) {
        return (
          <fieldset key={reactKey} className={css.fieldset}>
            <legend className={css.legend}>{label}</legend>
            <div className="space-y-4">{renderFields(value, segments)}</div>
          </fieldset>
        );
      }

      if (typeof value === 'string' && displayPath === 'content') {
        const lineCount = Math.max(1, value.split(/\r?\n/).length);
        return (
          <div key={reactKey}>
            <label htmlFor={fieldId} className={css.label}>{label}</label>
            <textarea
              id={fieldId}
              value={value}
              onChange={(event) => onFieldChange(segments, event.target.value)}
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

      if (typeof value === 'number' && Number.isFinite(value)) {
        return (
          <div key={reactKey}>
            <label htmlFor={fieldId} className={css.label}>{label}</label>
            <div className="mt-1 flex items-center">
              <DataCardNumberInput
                id={fieldId}
                value={value}
                onCommit={(next) => onFieldChange(segments, next)}
                className={inputClassName}
              />
              {addon?.inline}
            </div>
            {addon?.below}
          </div>
        );
      }

      if (typeof value === 'boolean') {
        return (
          <div key={reactKey}>
            <label htmlFor={fieldId} className={css.label}>{label}</label>
            <div className="mt-1 flex items-center">
              <input
                type="checkbox"
                id={fieldId}
                checked={value}
                onChange={(event) => onFieldChange(segments, event.target.checked)}
                className="h-5 w-5"
              />
              {addon?.inline}
            </div>
            {addon?.below}
          </div>
        );
      }

      if (typeof value !== 'string') {
        // null / undefined / 非有限 number 与其余 primitive：不知道用户期望的目标类型，
        // 只读展示而不是擅自转换（写入会破坏原 JSON 类型）。
        return (
          <div key={reactKey}>
            <label htmlFor={fieldId} className={css.label}>{label} (只读)</label>
            <input id={fieldId} value={readonlyPrimitiveText(value)} readOnly className={css.readonlyInput} />
          </div>
        );
      }

      return (
        <div key={reactKey}>
          <label htmlFor={fieldId} className={css.label}>{label}</label>
          <div className="mt-1 flex items-center">
            {value.length > 80 ? (
              <textarea
                id={fieldId}
                value={value}
                onChange={(event) => onFieldChange(segments, event.target.value)}
                rows={3}
                className={inputClassName}
                {...NON_CREDENTIAL_INPUT_PROPS}
              />
            ) : (
              <input
                type="text"
                id={fieldId}
                value={value}
                onChange={(event) => onFieldChange(segments, event.target.value)}
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

  return <>{renderFields(data, [])}</>;
};
