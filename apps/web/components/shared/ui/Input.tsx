'use client';

import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';

import clsx from 'clsx';

const controlClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100';

export const inputClassName = (className?: string): string => clsx(controlClass, className);

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={inputClassName(className)} {...props} />;
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/** Select 保留浏览器原生下拉箭头：不用 appearance-none 隐藏后再留空白。 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={inputClassName(className)} {...props} />;
});
