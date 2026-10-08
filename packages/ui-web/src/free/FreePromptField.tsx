import type { ReactNode } from 'react';
import { FREE_PROMPT_PLACEHOLDER } from './product';

export interface FreePromptFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly actions?: ReactNode;
  readonly hint?: ReactNode;
}

/** 提示词输入与字数反馈共享，存档/剪贴板动作仍由宿主注入。 */
export function FreePromptField({ value, onChange, disabled, actions, hint }: FreePromptFieldProps) {
  return (
    <div className="input-group">
      <label className="input-label">提示词（任意长度）</label>
      <textarea aria-label="提示词" value={value} onChange={(event) => onChange(event.target.value)} placeholder={FREE_PROMPT_PLACEHOLDER} className="input-field min-h-[10rem] resize-y" rows={10} disabled={disabled} />
      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span>字符数：{value.length}</span>
        {actions ? <div className="flex gap-3">{actions}</div> : null}
      </div>
      {hint ? <p className="mt-2 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}
