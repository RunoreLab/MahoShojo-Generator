import type { ReactNode } from 'react';

/** Web 的真实区段排布作为双端产品顺序；宿主仅注入受控字段与执行适配。 */
export function FreeFormSections({ schema, prompt, attachments, mode, language, provider, actions, tokens, feedback, navigation }: {
  schema: ReactNode; prompt: ReactNode; attachments: ReactNode; mode: ReactNode;
  language: ReactNode; provider: ReactNode; actions: ReactNode; tokens: ReactNode;
  feedback?: ReactNode; navigation?: ReactNode;
}) {
  return <div className="space-y-4">
    {schema}{prompt}{attachments}
    <div className="my-2 bg-gray-100 rounded-lg p-3">{mode}</div>
    {language}
    <div className="my-2 bg-gray-50 rounded-lg p-3">{provider}</div>
    {actions}{tokens}{feedback}{navigation}
  </div>;
}

export function FreePromptActions({ canCopy, disabled, onCopy, onClear }: {
  canCopy: boolean; disabled?: boolean; onCopy: () => void; onClear: () => void;
}) {
  return <>
    <button type="button" className="text-blue-600 hover:underline" onClick={onCopy} disabled={!canCopy}>复制提示词</button>
    <button type="button" className="text-red-600 hover:underline" onClick={onClear} disabled={disabled}>清空存档</button>
  </>;
}
