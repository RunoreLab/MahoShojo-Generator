import type { ReactNode } from 'react';
import { ScenarioJsonDetails } from './ScenarioResultContent';
import { ScenarioResultSurface } from './ScenarioResultSurface';

/** Web 通用情景 Markdown 工作区，宿主保留转换、签名及存储策略。 */
export function GeneralScenarioEditor({ draft, onCreate, onConvert, canConvert, onChange, disabled, reasoning, actions, sizeIndicator, feedback }: {
  draft: Record<string, unknown> | null;
  onCreate: () => void; onConvert: () => void; canConvert: boolean;
  onChange: (patch: { title?: string; content?: string }) => void;
  disabled?: boolean; reasoning?: ReactNode; actions?: ReactNode; sizeIndicator?: ReactNode; feedback?: ReactNode;
}) {
  return <ScenarioResultSurface label="通用情景卡编辑器">
    <div className="flex flex-col gap-3">
      <div className="flex flex-col md:flex-row justify-between gap-2">
        <h2 className="text-xl font-bold">通用情景卡（Markdown）</h2>
        <div className="flex gap-2">
          <button type="button" disabled={disabled} onClick={onCreate} className="generate-button flex-1" style={{ backgroundColor: '#a855f7', backgroundImage: 'linear-gradient(to right, #a855f7, #7c3aed)' }}>创建空白通用情景卡</button>
          <button type="button" onClick={onConvert} disabled={disabled || !canConvert} className="generate-button flex-1" style={{ backgroundColor: '#10b981', backgroundImage: 'linear-gradient(to right, #10b981, #059669)' }}>将生成结果转为通用情景卡</button>
        </div>
      </div>
      {draft ? <>
        <div className="space-y-4">
          <div className="input-group">
            <label htmlFor="general-scenario-title" className="input-label">情景名称</label>
            <input id="general-scenario-title" type="text" value={typeof draft.title === 'string' ? draft.title : ''} onChange={(event) => onChange({ title: event.target.value })} disabled={disabled} className="input-field" placeholder="请输入通用情景名称" />
          </div>
          <div className="input-group">
            <label htmlFor="general-scenario-content" className="input-label">情景内容（Markdown）</label>
            <textarea id="general-scenario-content" value={typeof draft.content === 'string' ? draft.content : ''} onChange={(event) => onChange({ content: event.target.value })} disabled={disabled} className="input-field resize-y" rows={12} placeholder="请在此处编写情景设定，建议使用 Markdown 小标题/列表。" />
          </div>
          {reasoning}
        </div>
        <ScenarioJsonDetails data={draft} />
        <div className="flex flex-col md:flex-row justify-center gap-2 mt-2">{actions}</div>
        {sizeIndicator}
      </> : <p className="text-xs text-gray-500">提示：通用情景卡只有 <code>title</code> 和 <code>content</code> 两个主要字段，适合用 Markdown 维护长线场景。</p>}
      {feedback}
    </div>
  </ScenarioResultSurface>;
}
