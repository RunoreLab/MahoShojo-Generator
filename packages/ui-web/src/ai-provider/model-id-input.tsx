import type { InputHTMLAttributes } from 'react';

/** Web 与 Desktop 的手填模型输入；校验共享 contracts，不在控件中截断用户输入。 */
export const AiProviderModelIdInput = ({ onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  onValueChange: (value: string) => void;
}) => <input
  className="input-field font-mono"
  type="text"
  aria-label="自定义模型 ID"
  placeholder="请输入该供应商支持的 modelId"
  autoComplete="off"
  spellCheck={false}
  {...props}
  onChange={(event) => onValueChange(event.target.value)}
/>;
