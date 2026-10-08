import { SCENARIO_QUESTIONS, SCENARIO_OPTIONAL_FIELDS } from './product';

export function ScenarioTitleField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <div className="input-group">
    <label htmlFor="scenario-title-hint" className="input-label">情景标题（可选）</label>
    <input id="scenario-title-hint" aria-label="情景标题" value={value} onChange={(event) => onChange(event.target.value)} placeholder="例如：深夜车站、雨夜访谈、黄昏钟楼" className="input-field" disabled={disabled} />
    <p className="text-xs text-gray-500 mt-1">用于流式生成时的标题回退；非流式会由 AI 自动命名。</p>
  </div>;
}

export function ScenarioQuestionFields({ answers, onChange }: { answers: Readonly<Record<string, string>>; onChange: (label: string, value: string) => void }) {
  return <>{SCENARIO_QUESTIONS.map((question) => <div key={question.id} className="input-group">
    <label htmlFor={question.id} className="input-label">{question.label}</label>
    <textarea id={question.id} aria-label={question.label} value={answers[question.label] ?? ''} onChange={(event) => onChange(question.label, event.target.value)} placeholder={question.placeholder} className="input-field resize-y h-24" rows={3} />
  </div>)}</>;
}

export function ScenarioBlankFields({ expanded, onToggle, fields, onChange }: { expanded: boolean; onToggle: () => void; fields: readonly string[]; onChange: (field: string) => void }) {
  return <div className="input-group mt-6">
    <button type="button" onClick={onToggle} className="text-sm font-semibold text-purple-700 hover:underline focus:outline-none">{expanded ? '▼ ' : '▶ '}高级选项：强制留空字段</button>
    {expanded && <div className="mt-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
      <p className="text-xs text-gray-600 mb-3">勾选你希望AI在生成时强制留空的字段，以获得更灵活的情景文件。</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SCENARIO_OPTIONAL_FIELDS.map((field) => <label key={field.value} className="flex items-center text-sm cursor-pointer">
          <input type="checkbox" checked={fields.includes(field.value)} onChange={() => onChange(field.value)} className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
          <span className="ml-2 text-gray-700">{field.label}</span>
        </label>)}
      </div>
    </div>}
  </div>;
}

export function ScenarioLanguageField({ value, languages, onChange, disabled }: { value: string; languages: readonly { code: string; name: string }[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <div className="input-group mt-6">
    <label htmlFor="scenario-language-select" className="input-label"><img src="/globe.svg" alt="Language" className="inline-block w-4 h-4 mr-2" />生成语言</label>
    <select id="scenario-language-select" aria-label="生成语言" value={value} onChange={(event) => onChange(event.target.value)} className="input-field" disabled={disabled}>
      {languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
    </select>
  </div>;
}
