import { useId, type ReactNode } from 'react';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon: ReactNode;
  description: string;
  /**
   * 选项级禁用（DESK-AIP-009）：禁用项渲染为不可点，`reason` 并入悬浮提示与
   * 无障碍说明。调用方仍应像之前一样用整组 `disabled` 表达「整段暂不可编辑」。
   */
  disabled?: boolean;
  reason?: string;
};

/** 轻量互斥选项组；说明使用原生悬浮提示，同时关联到辅助技术。 */
export function SegmentedControl<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: ReactNode;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const optionHint = (option: SegmentedOption<T>): string =>
    option.disabled && option.reason
      ? `${option.description}（不可用：${option.reason}）`
      : option.description;
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="input-label">{label}</legend>
      <div className="flex gap-1 rounded-full bg-gray-200 p-1 dark:bg-gray-800">
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            aria-describedby={`${id}-${index}`}
            title={optionHint(option)}
            disabled={disabled || option.disabled === true}
            onClick={() => onChange(option.value)}
            className={`flex min-h-11 min-w-0 flex-auto flex-col items-center justify-center gap-1 rounded-full px-2 py-2 text-xs font-semibold transition-colors duration-200 sm:flex-row sm:gap-2 sm:text-sm motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-500 disabled:cursor-not-allowed disabled:opacity-50 ${
              value === option.value
                ? 'bg-white text-pink-600 shadow-sm dark:bg-gray-700 dark:text-pink-300'
                : 'text-gray-600 enabled:hover:bg-white/60 enabled:hover:text-gray-900 dark:text-gray-300 dark:enabled:hover:bg-gray-700 dark:enabled:hover:text-white'
            }`}
          >
            <span aria-hidden="true" className="flex h-4 shrink-0 items-center justify-center text-base [&>svg]:size-4">{option.icon}</span>
            <span className="whitespace-nowrap">{option.label}</span>
          </button>
        ))}
      </div>
      {options.map((option, index) => <span key={option.value} id={`${id}-${index}`} className="sr-only">{optionHint(option)}</span>)}
    </fieldset>
  );
}
