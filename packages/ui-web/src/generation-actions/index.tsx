import type { ComponentPropsWithRef } from 'react';

/** 生成页已有的三类操作层级；不拥有派发、保存、确认或可信度判定。 */
export const generationActionClassNames = {
  primary: 'ui-web-generation-action ui-web-generation-action--primary',
  secondary: 'ui-web-generation-action ui-web-generation-action--secondary',
  destructive: 'ui-web-generation-action ui-web-generation-action--destructive',
} as const;

export type GenerationActionVariant = keyof typeof generationActionClassNames;

export interface GenerationActionButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: GenerationActionVariant;
}

/** 链接等原生元素可复用 classNames；按钮默认不提交宿主表单。 */
export function GenerationActionButton({
  variant = 'secondary', className, type = 'button', ...props
}: GenerationActionButtonProps) {
  return <button {...props} type={type} className={[generationActionClassNames[variant], className].filter(Boolean).join(' ')} />;
}
