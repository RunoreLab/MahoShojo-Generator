import type { ReactNode } from 'react';

/** 来自 Web 真实表单的区段顺序；Provider 的执行位置和凭据仍由宿主提供。 */
export function ScenarioFormSections({ inputs, advanced, provider, language, mode, actions, tokens, feedback }: {
  inputs: ReactNode; advanced: ReactNode; provider: ReactNode; language: ReactNode;
  mode: ReactNode; actions: ReactNode; tokens: ReactNode; feedback?: ReactNode;
}) {
  return <>
    <div className="space-y-6">{inputs}</div>
    {advanced}
    <div className="input-group mt-6">{provider}</div>
    {language}
    <div className="input-group mt-6">{mode}</div>
    <div className="mt-4 flex flex-col gap-3">{actions}</div>
    {tokens}
    {feedback}
  </>;
}

export function ScenarioDraftNotice({ storageLabel, updatedAt, disabled, onClear, feedback, saveUnavailable }: {
  storageLabel: string; saveUnavailable?: boolean; updatedAt?: number | null; disabled?: boolean; onClear: () => void; feedback?: ReactNode;
}) {
  return <div>
    <div className="flex flex-col gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <span>{saveUnavailable ? '自动保存暂不可用，请先保存或复制当前内容。' : updatedAt ? `已自动保存于 ${new Date(updatedAt).toLocaleTimeString()}` : `当前输入会自动保存到${storageLabel}，重新打开本页后可恢复。`}</span>
      <button type="button" onClick={onClear} disabled={disabled} className="text-left font-semibold text-amber-800 hover:text-amber-950 sm:text-right">清空本地草稿</button>
    </div>
    {feedback}
  </div>;
}

export const SCENARIO_CLEAR_DRAFT_CONFIRM = '确定要清空本页的回答、生成偏好和 Markdown 编辑内容吗？生成结果与已保存的数据卡不受影响。';
