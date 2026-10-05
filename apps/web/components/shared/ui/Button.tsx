'use client';

import { forwardRef, type ButtonHTMLAttributes, type ElementType } from 'react';

import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'md' | 'icon';

const baseClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const variantClass: Record<ButtonVariant, string> = {
  primary: 'border-fuchsia-600 bg-fuchsia-600 text-white hover:bg-fuchsia-700',
  secondary: 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800',
  danger: 'border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40',
  ghost: 'border-transparent bg-transparent text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
  link: 'border-transparent bg-transparent px-1 text-fuchsia-700 underline-offset-4 hover:underline dark:text-fuchsia-300',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-2.5 text-xs',
  md: 'min-h-10 px-3 py-2 text-sm',
  icon: 'min-h-10 min-w-10 p-0',
};

export type ButtonStyleOptions = {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className?: string;
};

/** 统一按钮样式来源：<Link>/<button> 与 Button 组件共用，业务代码不再自拼按钮 class。 */
export const buttonClassName = (options: ButtonStyleOptions = {}): string => (
  twMerge(clsx(
    baseClass,
    variantClass[options.variant ?? 'secondary'],
    sizeClass[options.size ?? 'md'],
    options.className,
  ))
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleOptions;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
});

/** 以按钮观感渲染任意元素（如 next/link），共享同一套 variant/size。 */
export function ButtonAs({
  as,
  variant,
  size,
  className,
  ...props
}: ButtonStyleOptions & { as: ElementType } & Record<string, unknown>) {
  const Component = as;
  return <Component className={buttonClassName({ variant, size, className })} {...props} />;
}
