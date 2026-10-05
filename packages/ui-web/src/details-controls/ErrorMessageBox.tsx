import type { ReactNode } from 'react';

export type ErrorMessageBoxProps = {
  message: ReactNode;
  className?: string;
  /** 可选的附属内容（如百科帮助链接），由宿主决定如何渲染链接。 */
  children?: ReactNode;
};

/**
 * 宿主无关的错误提示框：`.error-message` 主题类 + 可插槽的附加说明。
 * Web 的 `ErrorMessage` 在此基础上附加百科帮助链接。
 */
export function ErrorMessageBox({ message, className = 'error-message', children }: ErrorMessageBoxProps) {
  return (
    <div className={className} role="alert">
      <div className="whitespace-pre-wrap">{message}</div>
      {children}
    </div>
  );
}
