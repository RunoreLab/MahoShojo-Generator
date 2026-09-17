'use client';

import { useId, type ReactNode } from 'react';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon: ReactNode;
  description: string;
};

/** 轻量互斥选项组；说明使用原生悬浮提示，同时关联到辅助技术。 */
export function SegmentedControl<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
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
            title={option.description}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full px-2 py-2 text-xs font-semibold transition-colors duration-200 sm:flex-row sm:gap-2 sm:text-sm motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-500 disabled:cursor-not-allowed disabled:opacity-50 ${
              value === option.value
                ? 'bg-white text-pink-600 shadow-sm dark:bg-gray-700 dark:text-pink-300'
                : 'text-gray-600 enabled:hover:bg-white/60 enabled:hover:text-gray-900 dark:text-gray-300 dark:enabled:hover:bg-gray-700 dark:enabled:hover:text-white'
            }`}
          >
            <span aria-hidden="true" className="flex h-4 items-center justify-center text-base [&>svg]:size-4">{option.icon}</span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>
      {options.map((option, index) => <span key={option.value} id={`${id}-${index}`} className="sr-only">{option.description}</span>)}
    </fieldset>
  );
}
