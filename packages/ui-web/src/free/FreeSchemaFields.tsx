import type { FreeSchemaId } from '@mahoshojo/ai-core/free-generation';
import { buildFreeFieldGuide, FREE_SCHEMA_OPTIONS, type FreeSchemaOption } from './product';

export interface FreeSchemaFieldsProps {
  readonly schemaId: FreeSchemaId;
  readonly options: readonly FreeSchemaOption[];
  readonly onChange: (schemaId: FreeSchemaId) => void;
  readonly showFieldGuide: boolean;
  readonly onToggleFieldGuide: () => void;
  readonly disabled?: boolean;
}

/** Schema 选择和字段说明始终同源；可选列表由本次生效生成方式投影。 */
export function FreeSchemaFields({ schemaId, options, onChange, showFieldGuide, onToggleFieldGuide, disabled }: FreeSchemaFieldsProps) {
  return (
    <>
      <div className="input-group">
        <label className="input-label">选择 Schema</label>
        <select aria-label="选择 Schema" value={schemaId} onChange={(event) => onChange(event.target.value as FreeSchemaId)} className="input-field" disabled={disabled}>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <p className="text-xs text-gray-500 mt-1">{FREE_SCHEMA_OPTIONS.find((option) => option.id === schemaId)?.description}</p>
      </div>
      <div className="my-2 bg-gray-100 rounded-lg p-3">
        <button type="button" onClick={onToggleFieldGuide} className="flex items-center justify-between w-full text-left font-medium text-gray-700 hover:text-blue-600">
          <span>Schema 字段说明（系统提示词）</span>
          <span className="ml-2">{showFieldGuide ? '▼' : '▶'}</span>
        </button>
        {showFieldGuide && <div className="mt-3 rounded-lg bg-white/80 p-3 border border-gray-200 text-xs text-gray-700 whitespace-pre-wrap">{buildFreeFieldGuide(schemaId)}</div>}
      </div>
    </>
  );
}
