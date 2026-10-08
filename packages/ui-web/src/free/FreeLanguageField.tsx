import { useId } from 'react';

export interface FreeLanguageFieldProps {
  readonly value: string;
  readonly languages: readonly { code: string; name: string }[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onChange: (language: string) => void;
  readonly disabled?: boolean;
}

export function FreeLanguageField({ value, languages, expanded, onToggle, onChange, disabled }: FreeLanguageFieldProps) {
  const panelId = useId();
  return (
    <div className="my-2 bg-gray-100 rounded-lg p-3">
      <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle} className="flex items-center justify-between w-full text-left font-medium text-gray-700 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        <span>生成语言</span><span className="ml-2">{expanded ? '▼' : '▶'}</span>
      </button>
      <div id={panelId} hidden={!expanded} className="mt-3">
        {expanded && <select aria-label="生成语言" value={value} onChange={(event) => onChange(event.target.value)} className="input-field" disabled={disabled}>
          {languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
        </select>}
      </div>
    </div>
  );
}
