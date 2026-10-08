import { useId } from 'react';

export interface QuestionnaireLanguageSectionProps {
  variant: 'details' | 'canshou';
  expanded: boolean;
  onToggle: () => void;
  languages: readonly { code: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** 语言选择仅持有可访问标识；展开状态、语言偏好和回退值由宿主提供。 */
export function QuestionnaireLanguageSection({ variant, expanded, onToggle, languages, value, onChange, disabled }: QuestionnaireLanguageSectionProps) {
  const panelId = useId();
  return (
    <div className="my-4 bg-gray-100 rounded-lg p-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={`flex items-center justify-between w-full text-left font-medium text-gray-700 ${variant === 'canshou' ? 'hover:text-blue-600' : 'hover:text-gray-900'}`}
      >
        <span>
          {variant === 'canshou' && <img src="/globe.svg" alt="" aria-hidden="true" className="inline-block w-4 h-4 mr-2" />}
          生成语言
        </span>
        <span className="ml-2" aria-hidden="true">{expanded ? '▼' : '▶'}</span>
      </button>
      <div id={panelId} hidden={!expanded} className={expanded ? 'mt-3' : undefined}>
        {expanded && (
          <select aria-label="生成语言" value={value} onChange={(event) => onChange(event.target.value)} className="input-field" disabled={disabled}>
            {languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
